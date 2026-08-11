import SwiftUI

/// The app's top-level IA. Four parallel destinations, one swipe apart.
///
/// Replaces a single flat `List` that stacked broadcasts, DMs, the door and
/// every event — tonight's and one three months out — into one undifferentiated
/// stream. On a 40mm screen in a dark room that made the member do the sorting.
///
/// **Horizontal paging, deliberately.** `TicketStackView` already binds the
/// Digital Crown to `.verticalPage` for paging through passes. A vertical root
/// would nest vertical-on-vertical and make the Crown ambiguous — HIG W-DC-03.
/// W-NV-02 puts top-level sections on horizontal swipe for exactly this reason,
/// and four tabs is inside its five-tab ceiling.
struct RootTabs: View {
    @EnvironmentObject private var store: TicketStore
    @EnvironmentObject private var broadcasts: BroadcastStore
    @EnvironmentObject private var dms: DMStore

    @State private var tab: Tab = .now

    enum Tab: Hashable { case now, tickets, events, messages }

    var body: some View {
        TabView(selection: $tab) {
            NowView().tag(Tab.now)
            TicketsView().tag(Tab.tickets)
            EventsView().tag(Tab.events)
            MessagesView().tag(Tab.messages)
        }
        .tabViewStyle(.page)
        // Flat black, not a washed brand gradient. The gradient is spent on one
        // element on this watch (AccessRing); behind a whole tab it is a
        // section background the design system rules out, and on OLED it lights
        // pixels for nothing.
        .containerBackground(DVNT.canvas, for: .tabView)
        .onChange(of: tab) { _, _ in DVNT.Haptic.page() }
    }
}
