import SwiftUI

/// DVNT Apple Watch companion — a thin, native presenter over the phone's ticket
/// domain. Tickets-on-wrist + host-scannable QR. No React Native runs here.
@main
struct DVNTWatchApp: App {
    @StateObject private var store: TicketStore
    @StateObject private var broadcastStore: BroadcastStore
    @StateObject private var connectivity: WatchConnectivityManager

    init() {
        let store = TicketStore()
        let broadcastStore = BroadcastStore()
        _store = StateObject(wrappedValue: store)
        _broadcastStore = StateObject(wrappedValue: broadcastStore)
        _connectivity = StateObject(
            wrappedValue: WatchConnectivityManager(store: store, broadcastStore: broadcastStore)
        )
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .environmentObject(broadcastStore)
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
    var body: some View {
        EventListView()
    }
}
