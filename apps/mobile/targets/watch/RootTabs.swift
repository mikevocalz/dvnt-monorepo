import SwiftUI

/// PLATFORM BEHAVIOR: horizontal pages each own one navigation stack. Their
/// content scrolls with the Crown; a pushed TicketStackView owns pass paging.
/// NOT in this view: account data or per-conversation state.
/// STOP-THE-LINE CHECKS: no nested root stacks or tap-through Door pages.
struct RootTabs: View {
    @SceneStorage("watch.rootTab") private var tab = Tab.now.rawValue

    enum Tab: Int, CaseIterable { case now, inbox, events, tickets }

    var body: some View {
        TabView(selection: $tab) {
            NavigationStack { NowView() }
                .tag(Tab.now.rawValue)
            NavigationStack { MessagesView() }
                .tag(Tab.inbox.rawValue)
            NavigationStack { EventsView() }
                .tag(Tab.events.rawValue)
            NavigationStack { TicketsView() }
                .tag(Tab.tickets.rawValue)
        }
        .tabViewStyle(.page)
        .containerBackground(DVNT.canvas, for: .tabView)
        .overlay(alignment: .trailing) {
            GradientRail(index: tab, count: Tab.allCases.count)
        }
        .onChange(of: tab) { _, _ in DVNT.Haptic.page() }
    }
}
