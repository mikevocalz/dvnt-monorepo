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

    var body: some Scene {
        WindowGroup {
            RootView()
                .watchDeepLinks()
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
