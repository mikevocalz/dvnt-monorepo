import Foundation
import WatchConnectivity
import WatchKit
import WidgetKit

/// The spine of the phone⇄watch bridge. The phone holds the authed session and
/// pushes the member's current state — the ticket set (incl. `qrToken`s) and the
/// host-broadcast history — via WCSession; the watch only ever receives display
/// data, never DVNT credentials.
///
/// `updateApplicationContext` (latest-wins, coalesced) is the primary channel:
/// both "the current ticket set" and "the current broadcast list" are
/// replace-not-append state, merged into one context dict (`payload` +
/// `broadcasts`). `didReceiveUserInfo` / `didReceiveMessage` are also handled so
/// the phone can force-push promptly and so we can fire the right haptic on a
/// used-ticket transition or a fresh broadcast.
@MainActor
final class WatchConnectivityManager: NSObject, ObservableObject {
    private let store: TicketStore
    private let broadcastStore: BroadcastStore
    private let callStore: CallStore
    private let dmStore: DMStore
    private let doorStore: DoorStore
    private let eventStore: EventStore
    private let callDirectoryStore: CallDirectoryStore
    private let venueStore: VenueActionStore
    private let activeCallStore: ActiveCallStore
    private let sessionGate = WatchSessionGate()
    @Published var isReachable = false

    init(store: TicketStore,
         broadcastStore: BroadcastStore,
         callStore: CallStore,
         dmStore: DMStore,
         eventStore: EventStore,
         callDirectoryStore: CallDirectoryStore,
         venueStore: VenueActionStore,
         activeCallStore: ActiveCallStore,
         doorStore: DoorStore) {
        self.store = store
        self.broadcastStore = broadcastStore
        self.callStore = callStore
        self.dmStore = dmStore
        self.doorStore = doorStore
        self.eventStore = eventStore
        self.callDirectoryStore = callDirectoryStore
        self.venueStore = venueStore
        self.activeCallStore = activeCallStore
        super.init()
        callStore.relay = { [weak self] callId, action in
            self?.sendCallAction(callId: callId, action: action)
        }
        venueStore.relay = { [weak self] command in self?.sendVenueAction(command) ?? false }
        venueStore.requestSync = { [weak self] in self?.requestSync() }
        activeCallStore.relay = { [weak self] command in self?.sendActiveCallAction(command) ?? false }
        callDirectoryStore.relay = { [weak self] command in self?.sendCallDirectoryAction(command) ?? false }
        callDirectoryStore.requestSync = { [weak self] in self?.requestSync() }
        eventStore.relay = { [weak self] command in self?.sendEventAction(command) ?? false }
        eventStore.requestSync = { [weak self] in self?.requestSync() }
        dmStore.actionRelay = { [weak self] command, completion in self?.sendThreadAction(command, completion: completion) ?? false }
        dmStore.relay = { [weak self] command in self?.sendDMReply(command) ?? false }
        dmStore.loadThread = { [weak self] id, cursor in self?.requestThread(id, cursor: cursor) }
        dmStore.onAccountReset = { Task { await WatchMediaCache.shared.purge() } }
        dmStore.onSent = { WKInterfaceDevice.current().play(.success) }
        if sessionGate.requiresReset || (sessionGate.hasV2 && dmStore.envelope.accountGen != sessionGate.accountGen) { resetAccountStores() }
        if sessionGate.hasV2 {
            if doorStore.envelope.accountGen != sessionGate.accountGen { doorStore.resetAccount(sessionGate.accountGen) }
            if venueStore.accountGen != sessionGate.accountGen { venueStore.resetAccount(sessionGate.accountGen) }
            activeCallStore.resetAccount(sessionGate.accountGen)
        }
        guard WCSession.isSupported() else { return }
        WCSession.default.delegate = self
        WCSession.default.activate()
    }

    /// Answer/decline goes back over `sendMessage`, not the application context:
    /// a decision is an event, and the context slot is a latest-wins snapshot
    /// that tickets and broadcasts already share.
    private func sendCallAction(callId: String, action: String) {
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        guard let call = callStore.incoming, call.id == callId, let accountGen = call.accountGen else { return }
        let now = Date().timeIntervalSince1970
        let body: [String: Any] = ["type": "callAction", "callId": callId, "action": action,
            "protocol": 2, "accountGen": accountGen, "operationId": UUID().uuidString,
            "issuedAt": now, "expiresAt": min(now + 30, call.ringingSince + 30), "expectedStatus": "ringing"]
        if session.isReachable {
            session.sendMessage(body, replyHandler: nil, errorHandler: { [weak self] _ in
                // The phone was there a moment ago and is not now. Queue it —
                // a decline that never lands leaves the caller ringing out.
                self?.queueCallAction(body)
            })
        } else {
            queueCallAction(body)
        }
    }

    private func queueCallAction(_ body: [String: Any]) {
        guard let expires = body["expiresAt"] as? Double, expires > Date().timeIntervalSince1970 else { return }
        WCSession.default.transferUserInfo(body)
    }

    private func sendVenueAction(_ command: WatchVenueCommand) -> Bool {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable,
              command.accountGen == sessionGate.accountGen,
              let data = try? JSONEncoder().encode(command),
              let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return false }
        session.sendMessage(body, replyHandler: { [weak self] reply in
            Task { @MainActor in
                guard let self else { return }
                if reply["venueResult"] != nil { self.handlePayload(reply) }
                else { self.venueStore.fail(command, message: "Result not confirmed. Check your phone.") }
            }
        }, errorHandler: { [weak self] _ in
            Task { @MainActor in self?.venueStore.fail(command, message: "Result not confirmed. Check your phone.") }
        })
        return true
    }

    private func sendActiveCallAction(_ command: WatchActiveCallCommand) -> Bool {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable,
              command.accountGen == sessionGate.accountGen,
              let data = try? JSONEncoder().encode(command),
              let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return false }
        session.sendMessage(body, replyHandler: { [weak self] reply in
            Task { @MainActor in
                guard let self else { return }
                if reply["activeCallResult"] != nil { self.handlePayload(reply) }
                else { self.activeCallStore.fail(command, message: "Result not confirmed. Check your phone.") }
            }
        }, errorHandler: { [weak self] _ in
            Task { @MainActor in self?.activeCallStore.fail(command, message: "Result not confirmed. Check your phone.") }
        })
        return true
    }

    private func sendCallDirectoryAction(_ command: WatchCallDirectoryCommand) -> Bool {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable,
              command.accountGen == sessionGate.accountGen,
              let data = try? JSONEncoder().encode(command),
              let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return false }
        session.sendMessage(body, replyHandler: { [weak self] reply in
            Task { @MainActor in
                guard let self else { return }
                if reply["callDirectoryResult"] != nil { self.handlePayload(reply) }
                else { self.callDirectoryStore.fail(command, message: reply["error"] as? String ?? "Result not confirmed. Check your phone.") }
            }
        }, errorHandler: { [weak self] _ in
            Task { @MainActor in self?.callDirectoryStore.fail(command, message: "Couldn’t reach iPhone. Retry.") }
        })
        return true
    }

    private func sendEventAction(_ command: WatchEventCommand) -> Bool {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable,
              command.accountGen == sessionGate.accountGen,
              let data = try? JSONEncoder().encode(command),
              let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return false }
        session.sendMessage(body, replyHandler: { [weak self] reply in
            Task { @MainActor in
                guard let self else { return }
                if reply["eventResult"] != nil { self.handlePayload(reply) }
                else { self.eventStore.fail(command, message: "Result not confirmed. Check the event on your phone.") }
            }
        }, errorHandler: { [weak self] _ in
            Task { @MainActor in self?.eventStore.fail(command, message: "Couldn’t reach iPhone. Retry.") }
        })
        return true
    }

    private func sendThreadAction(_ command: WatchThreadAction, completion: @escaping (Bool, String?) -> Void) -> Bool {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable,
              command.accountGen == sessionGate.accountGen,
              let data = try? JSONEncoder().encode(command),
              let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return false }
        session.sendMessage(body, replyHandler: { [weak self] reply in
            Task { @MainActor in
                guard let self, self.dmStore.envelope.accountGen == command.accountGen else { return }
                let ok = reply["ok"] as? Bool == true && self.acceptScope(reply)
                completion(ok, reply["error"] as? String)
                if ok { self.requestSync() }
            }
        }, errorHandler: { _ in Task { @MainActor in completion(false, "Couldn’t update. Retry when connected.") } })
        return true
    }

    private func sendDMReply(_ command: WatchSendCommand) -> Bool {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable,
              let data = try? JSONEncoder().encode(command),
              let body = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] else { return false }
        session.sendMessage(body, replyHandler: { [weak self] reply in
            Task { @MainActor in
                if reply["commandResult"] != nil { self?.handlePayload(reply) }
                else { self?.dmStore.failSend(command.id, error: reply["error"] as? String ?? "Couldn’t confirm send. Retry.") }
            }
        }, errorHandler: { [weak self] _ in
            Task { @MainActor in self?.dmStore.failSend(command.id, error: "Couldn’t confirm send. Retry with iPhone connected.") }
        })
        return true
    }

    private func requestThread(_ id: String, cursor: WatchCursor?) {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else {
            dmStore.threadFailed(id, error: "iPhone unavailable. Cached messages remain here."); return
        }
        let requestedGen = dmStore.envelope.accountGen
        var body: [String: Any] = ["type": "threadPage", "protocol": 2,
            "accountGen": dmStore.envelope.accountGen, "conversationId": id]
        if let cursor { body["olderCursor"] = ["createdAt": cursor.createdAt, "id": cursor.id] }
        session.sendMessage(body, replyHandler: { [weak self] reply in
            Task { @MainActor in
                guard let self, self.dmStore.envelope.accountGen == requestedGen else { return }
                guard self.acceptScope(reply) else {
                    if reply["session"] == nil { self.dmStore.threadFailed(id, error: reply["error"] as? String ?? "Couldn’t load messages. Retry.") }
                    return
                }
                guard self.dmStore.envelope.accountGen == requestedGen else { return }
                if let data = self.jsonData(reply["threadPage"]),
                   let page = try? JSONDecoder().decode(WatchThreadPage.self, from: data) {
                    self.dmStore.receive(page, older: cursor != nil)
                } else { self.dmStore.threadFailed(id, error: reply["error"] as? String ?? "Couldn’t load messages. Retry.") }
            }
        }, errorHandler: { [weak self] _ in
            Task { @MainActor in
                guard let self, self.dmStore.envelope.accountGen == requestedGen else { return }
                self.dmStore.threadFailed(id, error: "Couldn’t reach iPhone. Retry.")
            }
        })
    }

    /// Ask the phone for a fresh set (e.g. on appear / manual refresh).
    func requestSync() {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else { return }
        session.sendMessage(["type": "requestDoor"], replyHandler: { [weak self] reply in
            Task { @MainActor in self?.handlePayload(reply) }
        }, errorHandler: nil)
        session.sendMessage(["type": "requestCallDirectory"], replyHandler: { [weak self] reply in
            Task { @MainActor in self?.handlePayload(reply) }
        }, errorHandler: nil)
        session.sendMessage(["type": "requestEvents"], replyHandler: { [weak self] reply in
            Task { @MainActor in self?.handlePayload(reply) }
        }, errorHandler: nil)
        session.sendMessage(["type": "requestTickets"], replyHandler: { [weak self] reply in
            Task { @MainActor in self?.handlePayload(reply) }
        }, errorHandler: nil)
        session.sendMessage(["type": "requestBroadcasts"], replyHandler: { [weak self] reply in
            Task { @MainActor in self?.handlePayload(reply) }
        }, errorHandler: nil)
        session.sendMessage(["type": "requestDMs"], replyHandler: { [weak self] reply in
            Task { @MainActor in self?.handlePayload(reply) }
        }, errorHandler: nil)
    }

    private var usedTicketIds: Set<String> {
        Set(store.envelope.tickets.filter { $0.status.isUsed }.map { $0.id })
    }

    /// Apply a payload from any channel and route by key:
    ///  - `payload`    → ticket set; fire `.success` if a ticket just went used.
    ///  - `broadcasts` → broadcast list; fire the arrival haptic for new messages.
    private func resetAccountStores() {
        store.apply(.empty); broadcastStore.apply(.empty); doorStore.resetAccount(sessionGate.accountGen)
        callStore.clear()
        UserDefaults(suiteName: "group.com.dvnt.app.watch")?.set(false, forKey: "dvnt.widget.showDetails")
        if #available(watchOS 26.0, *) { ControlCenter.shared.reloadControls(ofKind: "DVNTWidgetPrivacy") }
        eventStore.resetAccount(sessionGate.accountGen)
        callDirectoryStore.resetAccount(sessionGate.accountGen)
        venueStore.resetAccount(sessionGate.accountGen)
        activeCallStore.resetAccount(sessionGate.accountGen)
        dmStore.resetAccount(sessionGate.accountGen)
        WidgetCenter.shared.reloadAllTimelines()
        if #available(watchOS 26.0, *) { WidgetCenter.shared.invalidateRelevance(ofKind: "DVNTRelevantEvent") }
        sessionGate.completeReset()
    }

    private func acceptScope(_ payload: [String: Any]) -> Bool {
        if payload["session"] != nil {
            guard let data = jsonData(payload["session"]),
                  let session = try? JSONDecoder().decode(WatchSessionEnvelope.self, from: data),
                  sessionGate.accept(session) else { return false }
            if sessionGate.requiresReset { resetAccountStores() }
            return true
        }
        return !sessionGate.hasV2
    }

    @discardableResult private func handlePayload(_ payload: [String: Any]) -> Bool {
        let scoped = acceptScope(payload)
        // Command results carry their own generation and never establish a session.
        if !scoped && payload["session"] != nil { return false }

        if let data = jsonData(payload["commandResult"]),
           let result = try? JSONDecoder().decode(WatchCommandResult.self, from: data) { dmStore.receive(result) }

        if let data = jsonData(payload["eventResult"]),
           let result = try? JSONDecoder().decode(WatchEventResult.self, from: data) { eventStore.receive(result) }
        if let data = jsonData(payload["callDirectoryResult"]),
           let result = try? JSONDecoder().decode(WatchCallDirectoryResult.self, from: data) { callDirectoryStore.receive(result) }
        if let data = jsonData(payload["venueResult"]),
           let result = try? JSONDecoder().decode(WatchVenueResult.self, from: data) { venueStore.receive(result) }
        if let data = jsonData(payload["activeCallResult"]),
           let result = try? JSONDecoder().decode(WatchActiveCallResult.self, from: data) { activeCallStore.receive(result) }
        guard scoped else { return ["commandResult", "eventResult", "callDirectoryResult", "venueResult", "activeCallResult"].contains { payload[$0] != nil } }
        if let data = jsonData(payload["activeCall"]),
           let envelope = try? JSONDecoder().decode(WatchActiveCallEnvelope.self, from: data),
           envelope.accountGen == sessionGate.accountGen { activeCallStore.apply(envelope) }
        if let data = jsonData(payload["callDirectory"]),
           let envelope = try? JSONDecoder().decode(WatchCallDirectory.self, from: data),
           envelope.accountGen == sessionGate.accountGen { callDirectoryStore.apply(envelope) }
        if let data = jsonData(payload["events"]),
           let envelope = try? JSONDecoder().decode(WatchEventEnvelope.self, from: data),
           envelope.accountGen == sessionGate.accountGen { eventStore.apply(envelope) }
        if let data = jsonData(payload["threadPage"]),
           let page = try? JSONDecoder().decode(WatchThreadPage.self, from: data),
           page.accountGen == sessionGate.accountGen { dmStore.receive(page, older: false) }

        if let data = jsonData(payload["payload"]) {
            let beforeUsed = usedTicketIds
            store.ingest(json: data)
            if !usedTicketIds.subtracting(beforeUsed).isEmpty {
                WKInterfaceDevice.current().play(.success)
            }
        }

        // A call is an event, not a snapshot: `call` rings, `callEnded` clears.
        // Both arrive by sendMessage or transferUserInfo, never by context.
        if let data = jsonData(payload["call"]),
           let call = try? JSONDecoder().decode(WatchIncomingCall.self, from: data),
           call.protocol == 2, call.accountGen == sessionGate.accountGen {
            callStore.present(call)
        }
        if let ended = payload["callEnded"] as? String {
            callStore.clear(callId: ended.isEmpty ? nil : ended)
        }

        if let data = jsonData(payload["broadcasts"]) {
            let beforeUnread = broadcastStore.unreadIds
            broadcastStore.ingest(json: data)
            let fresh = broadcastStore.unreadIds.subtracting(beforeUnread)
            if let newest = broadcastStore.broadcasts.first(where: { fresh.contains($0.id) }) {
                // One deliberate haptic for the newest fresh message; intent picks
                // the weight (urgent → .notification). Rate-limited by "fresh"-set
                // diffing so a backfill of many at once doesn't machine-gun.
                WKInterfaceDevice.current().play(newest.intent.haptic)
            }
        }

        // Host mode: aggregate door counts. Silent — a number changing is not
        // an event worth buzzing a host's wrist for while they work a door.
        if let data = jsonData(payload["door"]),
           let envelope = try? JSONDecoder().decode(WatchDoorEnvelope.self, from: data),
           envelope.accountGen == sessionGate.accountGen { doorStore.apply(envelope) }

        if let data = jsonData(payload["dms"]),
           let envelope = try? JSONDecoder().decode(WatchDMEnvelope.self, from: data),
           !sessionGate.hasV2 || (envelope.protocol == 2 && envelope.accountGen == sessionGate.accountGen) {
            let beforeUnread = dmStore.unreadIds
            dmStore.apply(envelope)
            // One tap for any genuinely new thread, not one per thread — a
            // backfill after a spell out of range must not machine-gun.
            if !dmStore.unreadIds.subtracting(beforeUnread).isEmpty {
                WKInterfaceDevice.current().play(.click)
            }
        }
        if ["payload", "events", "broadcasts", "door", "dms"].contains(where: { payload[$0] != nil }) {
            WidgetCenter.shared.reloadAllTimelines()
            if #available(watchOS 26.0, *) { WidgetCenter.shared.invalidateRelevance(ofKind: "DVNTRelevantEvent") }
        }
        return true
    }

    /// Accept either a JSON string or raw Data under a context key.
    private func jsonData(_ value: Any?) -> Data? {
        if let str = value as? String { return str.data(using: .utf8) }
        if let data = value as? Data { return data }
        return nil
    }
}

extension WatchConnectivityManager: WCSessionDelegate {
    nonisolated func session(_ session: WCSession,
                             activationDidCompleteWith state: WCSessionActivationState,
                             error: Error?) {
        Task { @MainActor in self.isReachable = session.isReachable; self.requestSync(); self.dmStore.flushQueued() }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in
            self.isReachable = session.isReachable
            if session.isReachable { self.requestSync(); self.dmStore.flushQueued() }
        }
    }

    nonisolated func session(_ session: WCSession,
                             didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.handlePayload(applicationContext) }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        Task { @MainActor in self.handlePayload(userInfo) }
    }

    nonisolated func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        Task { @MainActor in self.handlePayload(message) }
    }

    nonisolated func session(_ session: WCSession,
                             didReceiveMessage message: [String: Any],
                             replyHandler: @escaping ([String: Any]) -> Void) {
        Task { @MainActor in replyHandler(["ok": self.handlePayload(message)]) }
    }
}
