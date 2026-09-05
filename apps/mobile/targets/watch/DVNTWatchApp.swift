import SwiftUI

/// DVNT Apple Watch companion — a thin, native presenter over the phone's ticket
/// domain. Tickets-on-wrist + host-scannable QR. No React Native runs here.
@main
struct DVNTWatchApp: App {
    @StateObject private var store: TicketStore
    @StateObject private var broadcastStore: BroadcastStore
    @State private var callStore: CallStore
    @State private var dmStore: DMStore
    @State private var eventStore: EventStore
    @State private var callDirectoryStore: CallDirectoryStore
    @State private var venueStore: VenueActionStore
    @State private var activeCallStore: ActiveCallStore
    @StateObject private var doorStore: DoorStore
    @StateObject private var connectivity: WatchConnectivityManager

    init() {
        let store = TicketStore()
        let broadcastStore = BroadcastStore()
        let callStore = CallStore()
        let dmStore = DMStore()
        let eventStore = EventStore()
        let callDirectoryStore = CallDirectoryStore()
        let venueStore = VenueActionStore()
        let activeCallStore = ActiveCallStore()
        let doorStore = DoorStore()
        _store = StateObject(wrappedValue: store)
        _broadcastStore = StateObject(wrappedValue: broadcastStore)
        _callStore = State(initialValue: callStore)
        _dmStore = State(initialValue: dmStore)
        _eventStore = State(initialValue: eventStore)
        _callDirectoryStore = State(initialValue: callDirectoryStore)
        _venueStore = State(initialValue: venueStore)
        _activeCallStore = State(initialValue: activeCallStore)
        _doorStore = StateObject(wrappedValue: doorStore)
        _connectivity = StateObject(
            wrappedValue: WatchConnectivityManager(
                store: store,
                broadcastStore: broadcastStore,
                callStore: callStore,
                dmStore: dmStore,
                eventStore: eventStore,
                callDirectoryStore: callDirectoryStore,
                venueStore: venueStore,
                activeCallStore: activeCallStore,
                doorStore: doorStore
            )
        )
    }

    @ViewBuilder private var captureRoot: some View {
        #if DEBUG
        if ProcessInfo.processInfo.arguments.contains("--watch-qa-native") {
            WatchNativeCapture()
        } else if ProcessInfo.processInfo.arguments.contains("--watch-qa-treatment-a") {
            WatchCaptureTreatment(compact: false)
        } else if ProcessInfo.processInfo.arguments.contains("--watch-qa-treatment-b") {
            WatchCaptureTreatment(compact: true)
        } else if ProcessInfo.processInfo.arguments.contains("--watch-qa-largest") {
            RootView().environment(\.dynamicTypeSize, .accessibility5)
        } else {
            RootView()
        }
        #else
        RootView()
        #endif
    }

    var body: some Scene {
        WindowGroup {
            captureRoot
                .watchDeepLinks()
                .watchQuickActions()
                .environmentObject(store)
                .environmentObject(broadcastStore)
                .environment(callStore)
                .environment(dmStore)
                .environment(eventStore)
                .environment(callDirectoryStore)
                .environment(venueStore)
                .environment(activeCallStore)
                .environmentObject(doorStore)
                .environmentObject(connectivity)
                .preferredColorScheme(.dark)
        }

        // Custom long-look for host broadcasts. Selected when a push carries the
        // `dvnt_broadcast` category, which the event-broadcast-message edge
        // function now stamps. The in-app Broadcasts list backfills everything
        // regardless of whether the live push interface fires.
        WKNotificationScene(
            controller: BroadcastNotificationController.self,
            category: BroadcastNotification.category
        )
    }
}

/// Straight to content. There used to be a 600 ms brand beat here, which is a
/// third of the time a wrist glance lasts spent showing a logo — and it was paid
/// on *every* raise, not just cold launch, because watchOS relaunches this scene
/// freely. `TicketStore.init` loads the App Group cache synchronously, so there
/// was never anything to wait for. The mark still sits in the navigation title.
private struct RootView: View {
    @Environment(CallStore.self) private var callStore
    @Environment(ActiveCallStore.self) private var activeCallStore

    var body: some View {
        ZStack {
            RootTabs()

            if activeCallStore.call != nil && activeCallStore.presented && callStore.incoming == nil {
                ActiveCallView().zIndex(0.5)
            }

            // A ringing call covers everything, including a presented pass. It
            // is the only thing on this watch that outranks a ticket, and it
            // must not be reachable by scrolling past.
            if let call = callStore.incoming {
                IncomingCallView(
                    call: call,
                    handedOff: callStore.handedOff,
                    onAccept: { callStore.accept() },
                    onDecline: { callStore.decline() }
                )
                .transition(.opacity)
                .zIndex(1)
            }
        }
        .animation(.easeOut(duration: 0.2), value: callStore.incoming)
    }
}

#if DEBUG
/// Explicit synthetic layout comparison. Never populated with account data and
/// unreachable in Release; launch args let simctl produce reproducible captures.
private struct WatchCaptureTreatment: View {
    let compact: Bool
    var body: some View {
        NavigationStack {
            List {
                DoorHeader(title: "After Hours", stub: "SAT • 10 PM", minimumHeight: compact ? 58 : 104)
                VStack(alignment: .leading, spacing: 6) {
                    Text("DESIGN FIXTURE").font(.caption2).foregroundStyle(.secondary)
                    Text("Your night starts here").font(.headline)
                    Text("Doors at 10 PM · Brooklyn").font(.caption)
                    Label("Show ticket", systemImage: "qrcode")
                        .font(.body).foregroundStyle(.cyan)
                }.fixedSize(horizontal: false, vertical: true)
            }
            .navigationTitle("Now")
        }
    }
}
#endif

#if DEBUG
/// Real production views fed memory-only, synthetic stores. No transport relay
/// is attached, and fixture payloads never enter the persistent App Group.
@MainActor private struct WatchNativeCapture: View {
    @State private var messages: DMStore
    @State private var events: EventStore
    @StateObject private var tickets: TicketStore
    private let screen: String

    init() {
        let messages = DMStore(defaults: nil)
        let events = EventStore(defaults: nil)
        let tickets = TicketStore(defaults: nil)
        let now = Date().timeIntervalSince1970
        let date = ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: now))
        let envelope: [String: Any] = ["protocol": 2, "accountGen": "qa-fixture", "syncedAt": now,
            "quickReplies": ["See you there", "On my way"], "status": "ready", "dms": [
                ["id": "qa-thread", "name": "Night Crew", "handle": "", "preview": "Meet by the front entrance?",
                 "timestamp": now, "unread": true, "isGroup": true, "category": "inbox", "lastMessageId": "qa-message-2"],
                ["id": "qa-second", "name": "Alex", "handle": "alex", "preview": "See you at doors ✨",
                 "timestamp": now - 60, "unread": false, "isGroup": false, "category": "inbox"]]]
        messages.ingest(json: try! JSONSerialization.data(withJSONObject: envelope))
        messages.receive(WatchThreadPage(protocol: 2, accountGen: "qa-fixture", conversationId: "qa-thread",
            messages: [
                WatchMessage(id: "qa-message-1", conversationId: "qa-thread", senderId: "qa-alex", senderName: "Alex", outgoing: false,
                    text: "Meet by the front entrance?", createdAt: date, attachments: []),
                WatchMessage(id: "qa-message-2", conversationId: "qa-thread", senderId: "qa-me", senderName: nil, outgoing: true,
                    text: "On my way. See you at doors!", createdAt: date, attachments: [])], olderCursor: nil), older: false)
        let event: [String: Any] = ["id": "qa-event", "title": "After Hours", "startAt": ISO8601DateFormatter().string(from: Date(timeIntervalSince1970: now + 3600)),
            "timeZone": "America/New_York", "location": "Brooklyn · Main entrance", "isOnline": false,
            "status": "active", "ticketingEnabled": true, "rsvp": "going", "saved": true, "host": false, "waitlist": [], "canJoinWaitlist": false]
        events.ingest(json: try! JSONSerialization.data(withJSONObject: ["protocol": 2, "accountGen": "qa-fixture", "syncedAt": now, "status": "ready", "events": [event]]))
        let ticket: [String: Any] = ["id": "qa-ticket", "eventId": "qa-event", "qrToken": String(repeating: "0", count: 64), "status": "valid",
            "eventTitle": "After Hours", "eventDate": event["startAt"]!, "tier": "vip", "tierName": "VIP", "isOwner": true,
            "qrMatrix": ["size": 45, "bits": "feb163650bfc13199214906e8154e4e4bb75aa872ab5dba7c5febbaec123145a8107faaaaaaaafe003ef1566002ebd7fc16c4a67b3601d5e8299fcb0c0ddd228c9fa98bfe1c4fc6a8f38bc948aa93a2f99ad5aa3bca706bd6aa6e61788c8aaa92266ff9ab9f8a437eaaaaf42b6f2c8a879fa69fb66f9ac428c4a6c6bead3ab5feae915811ba51a9f857f830fb1af44647deab5d25d0b4e9cbb313338fbb8be3d4cafdf1a9611d337507ff8c3fbd238b954522ab4c7861930a3ab29c89afa8982d47dce2ae2f0ebef1ea2e9bd3ff8cafa805c8c68ac4ff8252a1aaab0561111c71cba87ffeb8f9dd3601691baaebb0067afcb04c806e48fbfe23d330fd28"]]
        tickets.ingest(json: try! JSONSerialization.data(withJSONObject: ["tickets": [ticket], "syncedAt": now]))
        _messages = State(initialValue: messages)
        _events = State(initialValue: events)
        _tickets = StateObject(wrappedValue: tickets)
        screen = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix("--watch-qa-screen=") })?.components(separatedBy: "=").last ?? "inbox"
    }

    var body: some View {
        NavigationStack {
            switch screen {
            case "conversation":
                if let dm = messages.dms.first(where: { $0.id == "qa-thread" }) { DMDetailView(dm: dm) }
            case "event": EventDetailView(eventId: "qa-event")
            case "ticket":
                if let group = tickets.groups.first {
                    TicketStackView(group: group, showsDoorHeader: ProcessInfo.processInfo.arguments.contains("--watch-qa-expanded-door"))
                }
            default: MessagesView()
            }
        }
        .environment(messages).environment(events).environmentObject(tickets)
        .overlay(alignment: .bottomLeading) {
            Text("QA fixture").font(.system(size: 8)).foregroundStyle(.secondary)
                .padding(.horizontal, 4).background(DVNT.canvas)
                .offset(y: 16).allowsHitTesting(false)
        }
    }
}
#endif
