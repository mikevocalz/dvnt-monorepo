import SwiftUI

private struct WatchDeepLinkPresenter: ViewModifier {
    @Environment(DMStore.self) private var dms
    @Environment(CallStore.self) private var calls
    @State private var destination: WatchDeepLink?
    func body(content: Content) -> some View {
        content
            .onOpenURL { url in
                if calls.incoming == nil { destination = WatchDeepLink(url: url) }
            }
            .sheet(item: $destination) { route in
                NavigationStack {
                    WatchDeepLinkDestination(route: route)
                        .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { destination = nil } } }
                }
            }
            .onChange(of: dms.envelope.accountGen) { _, _ in destination = nil }
            .onChange(of: calls.incoming?.id) { _, id in if id != nil { destination = nil } }
    }
}

private struct WatchDeepLinkDestination: View {
    let route: WatchDeepLink
    @Environment(DMStore.self) private var dms
    @EnvironmentObject private var tickets: TicketStore
    var body: some View {
        Group {
            if route.accountGen != dms.envelope.accountGen {
                ContentUnavailableView("Link unavailable", systemImage: "lock")
            } else if route.kind == "event" {
                EventDetailView(eventId: route.target)
            } else if let group = tickets.groups.first(where: { $0.tickets.contains { $0.id == route.target } }) {
                TicketStackView(group: group, initialTicketId: route.target)
            } else {
                ContentUnavailableView("Pass unavailable", systemImage: "ticket")
            }
        }
    }
}
extension View {
    func watchDeepLinks() -> some View { modifier(WatchDeepLinkPresenter()) }
}
