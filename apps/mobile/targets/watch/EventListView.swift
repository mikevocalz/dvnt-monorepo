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
                            .listRowBackground(Color.clear)
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
            // One brand moment, not four. The wordmark now leads NowView
            // in content at a size that reads; a 16pt mark in the corner
            // opposite the clock was spending the mark on every tab
            // without being legible on any of them. Plain titles here
            // match DMListView's existing text-title precedent.
            .navigationTitle("Tickets")
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
            .navigationTitle("Events")
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
                    .listRowBackground(Color.clear)
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

/// One entry in the unified inbox. Broadcasts and conversations are different
/// records with different detail screens, so they are wrapped rather than
/// flattened into a common struct — each case keeps its own row anatomy and its
/// own destination, and nothing about either model has to bend to the other.
private enum InboxEntry: Identifiable {
    case broadcast(WatchBroadcast)
    case dm(WatchDM)

    /// Prefixed so a broadcast and a conversation that happen to share an id
    /// cannot collide in the ForEach.
    var id: String {
        switch self {
        case .broadcast(let b): return "b-\(b.id)"
        case .dm(let d): return "d-\(d.id)"
        }
    }

    /// Epoch seconds. Both models already store this as a Double, so the merge
    /// is a sort rather than a conversion.
    var sortKey: Double {
        switch self {
        case .broadcast(let b): return b.createdAt
        case .dm(let d): return d.timestamp
        }
    }

    var isUnread: Bool {
        switch self {
        case .broadcast(let b): return !b.read
        case .dm(let d): return d.unread
        }
    }
}

/// Host broadcasts and member conversations, interleaved newest-first.
///
/// This was a junction: two rows that led to two lists, so every message cost
/// two taps and a back-out. On a wrist "who wants me" has to be zero hops from
/// the swipe — HIG W-NV-05 puts the primary action one tap from launch, and
/// reading a message is the only reason this tab exists.
///
/// Chronology is the whole sort. No unread pinning: a list that reorders itself
/// as messages are read is a list the wearer cannot build muscle memory for,
/// and unread already reads at a glance from the row's accent and fill.
///
/// `BroadcastListView` and `DMListView` both survive this. The former is still
/// reached scoped-to-one-event from a ticket's QR screen
/// (`TicketStackView` -> `BroadcastListView(eventId:)`), and neither is deleted
/// merely because the junction that used to point at them is gone.
struct MessagesView: View {
    @EnvironmentObject private var broadcasts: BroadcastStore
    @EnvironmentObject private var dms: DMStore

    private var entries: [InboxEntry] {
        let merged = broadcasts.broadcasts.map(InboxEntry.broadcast)
            + dms.dms.map(InboxEntry.dm)
        return merged.sorted { $0.sortKey > $1.sortKey }
    }

    var body: some View {
        NavigationStack {
            Group {
                if broadcasts.isEmpty && dms.isEmpty {
                    EmptyMessagesView()
                } else {
                    List {
                        ForEach(entries) { entry in
                            switch entry {
                            case .broadcast(let b):
                                NavigationLink {
                                    BroadcastDetailView(broadcast: b)
                                } label: {
                                    BroadcastRow(broadcast: b)
                                }
                                .listRowBackground(inboxRowFill(unread: entry.isUnread))
                            case .dm(let d):
                                NavigationLink {
                                    DMDetailView(dm: d)
                                } label: {
                                    DMRow(dm: d)
                                }
                                .listRowBackground(inboxRowFill(unread: entry.isUnread))
                            }
                        }
                    }
                    .listStyle(.carousel)
                }
            }
            .navigationTitle("Messages")
            .containerBackground(DVNT.canvas, for: .navigation)
        }
    }

    /// The same unread treatment both standalone lists already use, applied from
    /// one place so a mixed list cannot show two different ideas of "unread".
    private func inboxRowFill(unread: Bool) -> some View {
        RoundedRectangle(cornerRadius: DVNT.Radius.card, style: .continuous)
            .fill(unread ? DVNT.hairline : DVNT.Surface.low)
    }
}

// MARK: - Shared chrome

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

/// An art-forward event card. The flyer (or the event's `dominantHex` when the
/// art has not arrived) is the background; the text sits on a scrim over it.
///
/// This replaces three lines of text on flat black, which is what made a
/// ticketing app read as a database view.
struct EventRow: View {
    let group: EventGroup

    var body: some View {
        ZStack(alignment: .bottomLeading) {
            EventArt(group: group)

            // A neutral black ramp, NOT the brand gradient — this is a
            // legibility device, not a brand stroke. Title type has to clear
            // an arbitrary flyer underneath it, and a member reads this at
            // arm's length in a dark room.
            LinearGradient(
                colors: [.clear, .black.opacity(0.55), .black.opacity(0.9)],
                startPoint: .top,
                endPoint: .bottom
            )

            VStack(alignment: .leading, spacing: DVNT.Space.hair) {
                Text(group.title)
                    .font(DVNT.TypeScale.title())
                    .foregroundColor(.white)
                    .lineLimit(2)
                HStack(spacing: DVNT.Space.snug) {
                    if let date = group.date {
                        Text(date.formatted(date: .abbreviated, time: .shortened))
                            .font(DVNT.TypeScale.caption())
                            .foregroundColor(DVNT.OnArt.secondary)
                    }
                    if group.hasPresentable { LiveDot() }
                }
                if let loc = group.location, !loc.isEmpty {
                    Text(loc)
                        .font(DVNT.TypeScale.caption(13))
                        .foregroundColor(DVNT.OnArt.tertiary)
                        .lineLimit(1)
                }
            }
            .padding(DVNT.Space.roomy)
            .frame(maxWidth: .infinity, alignment: .leading)

            CountBadge(count: group.count, active: group.hasPresentable)
                .padding(DVNT.Space.base)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
        }
        .frame(height: 108)
        .clipShape(RoundedRectangle(cornerRadius: DVNT.Radius.card, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: DVNT.Radius.card, style: .continuous)
                .strokeBorder(
                    group.hasPresentable ? DVNT.accent.opacity(0.55) : DVNT.Surface.hairline,
                    lineWidth: 1
                )
        )
        .accessibilityElement(children: .combine)
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
