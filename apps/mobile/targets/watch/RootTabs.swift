import SwiftUI

/// The app's top-level IA. Four parallel destinations, one swipe apart.
///
/// Now, Tickets, and Events retain DVNT's art-led Door treatment. Inbox is the
/// deliberate exception: a wrist message destination must land on people and
/// messages immediately instead of spending another tap on decorative chrome.
///
/// **Horizontal paging, deliberately.** `TicketStackView` already binds the
/// Digital Crown to `.verticalPage` for paging through passes. A vertical root
/// would nest vertical-on-vertical and make the Crown ambiguous. Keeping root
/// paging horizontal also leaves vertical Crown movement to lists and threads.
struct RootTabs: View {
    @EnvironmentObject private var store: TicketStore
    @EnvironmentObject private var broadcasts: BroadcastStore
    @EnvironmentObject private var dms: DMStore

    @State private var tab: Tab = .now

    enum Tab: Int, Hashable, CaseIterable { case now, tickets, events, messages }

    var body: some View {
        TabView(selection: $tab) {
            MarqueePage(
                art: art(store.focus),
                eyebrow: store.isDoorsOpen ? "Live now" : "Tonight",
                title: store.focus?.title ?? "Nothing tonight",
                stub: store.nowStub,
                live: store.isDoorsOpen,
                showsWordmark: true
            ) { NowView() }
                .tag(Tab.now)

            MarqueePage(
                art: art(store.focus),
                eyebrow: "Tickets",
                title: "Your tickets",
                stub: store.ticketStub
            ) { TicketsView() }
                .tag(Tab.tickets)

            MarqueePage(
                art: art(store.upcoming.first),
                eyebrow: "Events",
                title: "What's coming",
                stub: store.upcomingStub
            ) { EventsView() }
                .tag(Tab.events)

            // Inbox is content-first. The previous full-screen Messages Door
            // added an unnecessary tap before the only content a wearer came
            // here to see. `MessagesView` owns its NavigationStack and opens
            // directly into the unified DM + host-broadcast list.
            MessagesView()
                .tag(Tab.messages)
        }
        .tabViewStyle(.page)
        .containerBackground(DVNT.canvas, for: .tabView)
        .overlay(alignment: .trailing) {
            GradientRail(index: tab.rawValue, count: Tab.allCases.count)
        }
        .onChange(of: tab) { _, _ in DVNT.Haptic.page() }
    }

    private func art(_ group: EventGroup?) -> EventArtSource {
        guard let group else { return .none }
        return .event(imageURL: group.imageURL, dominantHex: group.dominantHex)
    }

    /// Broadcasts + DMs share one Inbox surface, so its unread count remains
    /// useful to complications/other chrome even though the Door is gone.
    private var unreadCount: Int {
        broadcasts.unreadCount + dms.unreadCount
    }
}
