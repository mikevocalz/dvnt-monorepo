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

private struct RootView: View {
    @EnvironmentObject private var store: TicketStore
    @State private var booted = false

    var body: some View {
        Group {
            if booted {
                EventListView()
            } else {
                LaunchView()
            }
        }
        .task {
            // Brief brand launch beat, then reveal. (Tickets are already loaded
            // from the App Group cache synchronously in TicketStore.init.)
            try? await Task.sleep(nanoseconds: 600_000_000)
            withAnimation(.easeOut(duration: 0.25)) { booted = true }
        }
    }
}
