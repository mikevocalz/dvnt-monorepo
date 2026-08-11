import SwiftUI

/// The three list destinations behind `RootTabs`: live passes, the sectioned
/// event history, and the message surfaces.
///
/// This file used to hold a single flat `EventListView` — broadcasts, DMs, the
/// door and every event in one uniform stream, sorted only by "has a presentable
/// ticket, then date". Nothing was categorised, so nothing was findable.

// MARK: - Tickets

/// Everything the member can actually present at a door right now. This is the
/// tab that answers "let me in", so it holds only live passes and nothing else —
/// a revoked or already-scanned ticket in this list is a false promise.
struct TicketsView: View {
    @EnvironmentObject private var store: TicketStore
    @EnvironmentObject private var connectivity: WatchConnectivityManager

    private var live: [EventGroup] { store.groups.filter(\.hasPresentable) }

    var body: some View {
        NavigationStack {
            Group {
                if live.isEmpty {
                    EmptyTicketsView(reachable: connectivity.isReachable)
                } else {
                    List {
                        ForEach(Array(live.enumerated()), id: \.element.id) { i, group in
                            NavigationLink(value: group.id) {
                                EventRow(group: group)
                            }
                            .listRowBackground(rowBackground(group))
                            .appearStaggered(index: i)
                        }
                        StalenessFooter()
                    }
                    .listStyle(.carousel)
                }
            }
            .navigationDestination(for: String.self) { id in
                if let group = store.groups.first(where: { $0.id == id }) {
                    TicketStackView(group: group)
                }
            }
            .navigationTitle { DVNTLogoView(height: 16) }
            .containerBackground(DVNT.canvas, for: .navigation)
        }
        .onAppear { connectivity.requestSync() }
    }
}

// MARK: - Events

/// The full event history, in three sections. Tonight is a privileged position,
/// not a row that happens to sort first.
struct EventsView: View {
    @EnvironmentObject private var store: TicketStore
    @EnvironmentObject private var connectivity: WatchConnectivityManager

    var body: some View {
        NavigationStack {
            Group {
                if store.isEmpty {
                    EmptyTicketsView(reachable: connectivity.isReachable)
                } else {
                    List {
                        section("Tonight", store.tonight, startIndex: 0)
                        section("Upcoming", store.upcoming, startIndex: store.tonight.count)
                        section("Past", store.past,
                                startIndex: store.tonight.count + store.upcoming.count)
                        StalenessFooter()
                    }
                    .listStyle(.carousel)
                }
            }
            .navigationDestination(for: String.self) { id in
                if let group = store.groups.first(where: { $0.id == id }) {
                    TicketStackView(group: group)
                }
            }
            .navigationTitle { DVNTLogoView(height: 16) }
            .containerBackground(DVNT.canvas, for: .navigation)
        }
    }

    /// `startIndex` keeps the entrance stagger continuous across section
    /// boundaries, so the screen assembles top-to-bottom as one movement
    /// instead of three lists racing each other.
    @ViewBuilder
    private func section(_ title: String, _ groups: [EventGroup], startIndex: Int) -> some View {
        if !groups.isEmpty {
            Section {
                ForEach(Array(groups.enumerated()), id: \.element.id) { i, group in
                    NavigationLink(value: group.id) {
                        EventRow(group: group)
                    }
                    .listRowBackground(rowBackground(group))
                    .appearStaggered(index: startIndex + i)
                }
            } header: {
                Text(title.uppercased())
                    .font(DVNT.TypeScale.stamp())
                    .tracking(DVNT.TypeScale.stampTracking)
                    .foregroundColor(DVNT.textFaint)
            }
        }
    }
}

// MARK: - Messages

/// Host broadcasts and member conversations. These were entry rows wedged above
/// the event list; they are their own destination now, which is also what stops
/// an unread badge from competing with tonight's door for attention.
struct MessagesView: View {
    @EnvironmentObject private var broadcasts: BroadcastStore
    @EnvironmentObject private var dms: DMStore

    var body: some View {
        NavigationStack {
            Group {
                if broadcasts.isEmpty && dms.isEmpty {
                    EmptyMessagesView()
                } else {
                    List {
                        if !broadcasts.isEmpty {
                            NavigationLink {
                                BroadcastListView()
                            } label: {
                                BroadcastsEntryRow(unread: broadcasts.unreadCount)
                            }
                            .entryRowBackground()
                        }
                        if !dms.isEmpty {
                            NavigationLink {
                                DMListView()
                            } label: {
                                DMsEntryRow(unread: dms.unreadCount)
                            }
                            .entryRowBackground()
                        }
                    }
                    .listStyle(.carousel)
                }
            }
            .navigationTitle { DVNTLogoView(height: 16) }
            .containerBackground(DVNT.canvas, for: .navigation)
        }
    }
}

// MARK: - Shared chrome

/// An event row: cyan edge when something in it can actually be presented at a
/// door, plain hairline otherwise.
func rowBackground(_ group: EventGroup) -> some View {
    cardBackground(
        fill: DVNT.Surface.mid,
        stroke: group.hasPresentable ? DVNT.accent.opacity(0.5) : DVNT.Surface.hairline
    )
}

/// The shared card chrome behind every list row. This was five copies of the
/// same `RoundedRectangle(cornerRadius: 14) + strokeBorder` pair.
func cardBackground(fill: Color, stroke: Color) -> some View {
    RoundedRectangle(cornerRadius: DVNT.Radius.card, style: .continuous)
        .fill(fill)
        .overlay(
            RoundedRectangle(cornerRadius: DVNT.Radius.card, style: .continuous)
                .strokeBorder(stroke, lineWidth: 1)
        )
}

extension View {
    /// Chrome for the privileged entry rows (Broadcasts / Messages / Door).
    func entryRowBackground() -> some View {
        listRowBackground(cardBackground(fill: DVNT.Surface.low, stroke: DVNT.hairline))
    }
}

struct EventRow: View {
    let group: EventGroup

    var body: some View {
        VStack(alignment: .leading, spacing: DVNT.Space.tight) {
            HStack {
                Text(group.title)
                    .font(DVNT.TypeScale.title())
                    .foregroundColor(.white)
                    .lineLimit(2)
                Spacer(minLength: DVNT.Space.snug)
                if group.hasPresentable { LiveDot() }
                CountBadge(count: group.count, active: group.hasPresentable)
            }
            if let date = group.date {
                Text(date.formatted(date: .abbreviated, time: .shortened))
                    .font(DVNT.TypeScale.caption())
                    .foregroundColor(DVNT.textDim)
            }
            if let loc = group.location, !loc.isEmpty {
                Text(loc)
                    .font(DVNT.TypeScale.caption(13))
                    .foregroundColor(DVNT.textFaint)
                    .lineLimit(1)
            }
        }
        .padding(.vertical, DVNT.Space.tight)
    }
}

private struct CountBadge: View {
    let count: Int
    let active: Bool
    var body: some View {
        Text("\(count)")
            .font(DVNT.TypeScale.stamp(14))
            .foregroundColor(active ? .black : .white)
            .frame(minWidth: 22, minHeight: 22)
            .padding(.horizontal, DVNT.Space.tight)
            // Flat. The one gradient on this target is the AccessRing.
            .background(Capsule().fill(active ? Color.white : DVNT.Surface.high))
            .accessibilityLabel("\(count) ticket\(count == 1 ? "" : "s")")
    }
}

/// Home-list entry into the host-broadcast history, with an unread badge.
struct BroadcastsEntryRow: View {
    let unread: Int
    var body: some View {
        HStack(spacing: DVNT.Space.base) {
            Image(systemName: "megaphone.fill")
                .font(.system(size: DVNT.TypeScale.Icon.row))
                .foregroundColor(.white)
            Text("Messages from host")
                .font(DVNT.TypeScale.body())
                .foregroundColor(.white)
                .lineLimit(1)
            Spacer(minLength: DVNT.Space.tight)
            if unread > 0 {
                Text("\(unread)")
                    .font(DVNT.TypeScale.stamp(14))
                    // White on signal-red, not black: #FC253A against black type
                    // is a ~2.6:1 pair, which fails at a glance in a dark venue.
                    .foregroundColor(.white)
                    .frame(minWidth: 22, minHeight: 22)
                    .padding(.horizontal, DVNT.Space.tight)
                    .background(Capsule().fill(DVNT.signal))
            }
        }
        .padding(.vertical, DVNT.Space.tight)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(unread > 0
            ? "Messages from host, \(unread) unread"
            : "Messages from host")
    }
}

/// Home-list entry into the member's conversations, with an unread badge.
struct DMsEntryRow: View {
    let unread: Int
    var body: some View {
        HStack(spacing: DVNT.Space.base) {
            Image(systemName: "message.fill")
                .font(.system(size: DVNT.TypeScale.Icon.row))
                .foregroundColor(.white)
            Text("Messages")
                .font(DVNT.TypeScale.body())
                .foregroundColor(.white)
                .lineLimit(1)
            Spacer(minLength: DVNT.Space.tight)
            if unread > 0 {
                Text("\(unread)")
                    .font(DVNT.TypeScale.stamp(14))
                    .foregroundColor(.black)
                    .frame(minWidth: 22, minHeight: 22)
                    .padding(.horizontal, DVNT.Space.tight)
                    // Cyan, not signal-red: an unread DM is not an emergency,
                    // and red is spent on the host's urgent broadcasts.
                    .background(Capsule().fill(DVNT.accent))
            }
        }
        .padding(.vertical, DVNT.Space.tight)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(unread > 0 ? "Messages, \(unread) unread" : "Messages")
    }
}

/// Home-list entry into host mode. Only present while an event is running.
struct DoorEntryRow: View {
    let arrived: Int
    let remaining: Int
    var body: some View {
        HStack(spacing: DVNT.Space.base) {
            Image(systemName: "door.left.hand.open")
                .font(.system(size: DVNT.TypeScale.Icon.row))
                .foregroundColor(.white)
            Text("Door")
                .font(DVNT.TypeScale.body())
                .foregroundColor(.white)
            Spacer(minLength: DVNT.Space.tight)
            Text("\(arrived) in · \(remaining) out")
                .font(DVNT.TypeScale.caption(13))
                .foregroundColor(DVNT.textDim)
        }
        .padding(.vertical, DVNT.Space.tight)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Door: \(arrived) arrived, \(remaining) still outside")
    }
}

/// Honest staleness. Kept as a list footer on every ticket-bearing tab, because
/// a pass the member cannot verify the freshness of is worse than no pass.
struct StalenessFooter: View {
    @EnvironmentObject private var store: TicketStore
    @EnvironmentObject private var connectivity: WatchConnectivityManager

    var body: some View {
        if let synced = store.syncedAt {
            HStack(spacing: DVNT.Space.snug) {
                Image(systemName: connectivity.isReachable ? "checkmark.circle" : "iphone.slash")
                    .font(.system(size: DVNT.TypeScale.Icon.inline))
                Text(connectivity.isReachable
                     ? "Live"
                     : "As of \(synced.formatted(date: .omitted, time: .shortened))")
                    .font(DVNT.TypeScale.caption(13))
            }
            .foregroundColor(DVNT.textFaint)
            .frame(maxWidth: .infinity)
            .listRowBackground(Color.clear)
            .accessibilityElement(children: .combine)
        }
    }
}

struct EmptyTicketsView: View {
    let reachable: Bool
    var body: some View {
        ContentUnavailableView {
            Label("No tickets yet", systemImage: "ticket")
                .font(DVNT.TypeScale.title())
        } description: {
            Text(reachable ? "Buy on your iPhone — they appear here."
                           : "Open DVNT on your iPhone to sync.")
                .font(DVNT.TypeScale.body())
        }
        .containerBackground(DVNT.canvas, for: .navigation)
    }
}

struct EmptyMessagesView: View {
    var body: some View {
        ContentUnavailableView {
            Label("No messages", systemImage: "message")
                .font(DVNT.TypeScale.title())
        } description: {
            Text("Notes from your hosts land here.")
                .font(DVNT.TypeScale.body())
        }
        .containerBackground(DVNT.canvas, for: .navigation)
    }
}
