import SwiftUI

/// The app's top-level IA. Four parallel destinations, one swipe apart — now
/// drawn as Doors (see `Marquee.swift`) rather than as four bare screens.
///
/// Replaces a single flat `List` that stacked broadcasts, DMs, the door and
/// every event — tonight's and one three months out — into one undifferentiated
/// stream. On a 40mm screen in a dark room that made the member do the sorting.
///
/// **Horizontal paging, deliberately.** `TicketStackView` already binds the
/// Digital Crown to `.verticalPage` for paging through passes. A vertical root
/// would nest vertical-on-vertical and make the Crown ambiguous — HIG W-DC-03.
/// W-NV-02 puts top-level sections on horizontal swipe for exactly this reason,
/// and four tabs is inside its five-tab ceiling. The design spec asked for
/// `.verticalPage`; that is the one part of it not adopted, and this is why.
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
                live: store.isDoorsOpen
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

            MarqueePage(
                art: .mosaic(dms.recentAvatarURLs),
                eyebrow: "Messages",
                title: "From hosts",
                stub: unreadStub
            ) { MessagesView() }
                .tag(Tab.messages)
        }
        .tabViewStyle(.page)
        // Flat black, not a washed brand gradient. The gradient is spent on two
        // elements on this watch (AccessRing and the rail); behind a whole tab
        // it is a section background the design system rules out, and on OLED it
        // lights pixels for nothing.
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

    /// Broadcasts + DMs share one Messages surface, so the stub counts both.
    private var unreadStub: String? {
        let n = broadcasts.unreadCount + dms.unreadCount
        return n > 0 ? "\(n) UNREAD" : nil
    }
}
