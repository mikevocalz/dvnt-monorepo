import Foundation
import WatchConnectivity
import WatchKit

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
    @Published var isReachable = false

    init(store: TicketStore,
         broadcastStore: BroadcastStore,
         callStore: CallStore,
         dmStore: DMStore,
         doorStore: DoorStore) {
        self.store = store
        self.broadcastStore = broadcastStore
        self.callStore = callStore
        self.dmStore = dmStore
        self.doorStore = doorStore
        super.init()
        callStore.relay = { [weak self] callId, action in
            self?.sendCallAction(callId: callId, action: action)
        }
        dmStore.relay = { [weak self] conversationId, text in
            self?.sendDMReply(conversationId: conversationId, text: text)
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
        let body: [String: Any] = ["type": "callAction", "callId": callId, "action": action]
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
        WCSession.default.transferUserInfo(body)
    }

    /// Relay a reply typed on the wrist. The watch holds no DVNT session, so it
    /// carries words and the phone performs the send.
    ///
    /// `sentAt` is the phone's de-duplication key: the live `sendMessage` and the
    /// queued `transferUserInfo` can both land for one tap, and sending the same
    /// line to another person twice is a bug they can see.
    private func sendDMReply(conversationId: String, text: String) {
        let session = WCSession.default
        guard session.activationState == .activated else { return }
        let body: [String: Any] = [
            "type": "dmReply",
            "conversationId": conversationId,
            "text": text,
            "sentAt": Date().timeIntervalSince1970,
        ]
        if session.isReachable {
            session.sendMessage(body, replyHandler: nil, errorHandler: { _ in
                session.transferUserInfo(body)
            })
        } else {
            session.transferUserInfo(body)
        }
    }

    /// Ask the phone for a fresh set (e.g. on appear / manual refresh).
    func requestSync() {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else { return }
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
    private func handlePayload(_ payload: [String: Any]) {
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
           let call = try? JSONDecoder().decode(WatchIncomingCall.self, from: data) {
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
        if let data = jsonData(payload["door"]) {
            doorStore.ingest(json: data)
        }

        if let data = jsonData(payload["dms"]) {
            let beforeUnread = dmStore.unreadIds
            dmStore.ingest(json: data)
            // One tap for any genuinely new thread, not one per thread — a
            // backfill after a spell out of range must not machine-gun.
            if !dmStore.unreadIds.subtracting(beforeUnread).isEmpty {
                WKInterfaceDevice.current().play(.click)
            }
        }
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
        Task { @MainActor in self.isReachable = session.isReachable }
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in
            self.isReachable = session.isReachable
            if session.isReachable { self.requestSync() }
        }
    }

    nonisolated func session(_ session: WCSession,
                             didReceiveApplicationContext applicationContext: [String: Any]) {
        Task { @MainActor in self.handlePayload(applicationContext) }
    }

    nonisolated func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any]) {
        Task { @MainActor in self.handlePayload(userInfo) }
    }

    nonisolated func session(_ session: WCSession,
                             didReceiveMessage message: [String: Any],
                             replyHandler: @escaping ([String: Any]) -> Void) {
        Task { @MainActor in self.handlePayload(message) }
        replyHandler(["ok": true])
    }
}
