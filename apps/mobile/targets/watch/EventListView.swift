import SwiftUI

/// Home screen: a glanceable list of events, each row showing name, date, door
/// time and a ticket-count badge. Tapping an event opens its paged QR stack.
struct EventListView: View {
    @EnvironmentObject private var store: TicketStore
    @EnvironmentObject private var broadcasts: BroadcastStore
    @EnvironmentObject private var connectivity: WatchConnectivityManager

    var body: some View {
        NavigationStack {
            Group {
                if store.isEmpty && broadcasts.isEmpty {
                    EmptyTicketsView(reachable: connectivity.isReachable)
                } else {
                    List {
                        if !broadcasts.isEmpty {
                            NavigationLink {
                                BroadcastListView()
                            } label: {
                                BroadcastsEntryRow(unread: broadcasts.unreadCount)
                            }
                            .listRowBackground(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .fill(DVNT.surface)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                                            .strokeBorder(DVNT.hairline, lineWidth: 1)
                                    )
                            )
                        }
                        ForEach(store.groups) { group in
                            NavigationLink(value: group.id) {
                                EventRow(group: group)
                            }
                            .listRowBackground(rowBackground(group))
                        }
                        if let synced = store.syncedAt {
                            StalenessRow(syncedAt: synced, reachable: connectivity.isReachable)
                                .listRowBackground(Color.clear)
                        }
                    }
                    .listStyle(.carousel)
                }
            }
            .navigationDestination(for: String.self) { eventId in
                if let group = store.groups.first(where: { $0.id == eventId }) {
                    TicketStackView(group: group)
                }
            }
            // watchOS has no `.principal` toolbar placement — the view-builder
            // navigationTitle (watchOS 10+) is how a mark takes the title slot.
            .navigationTitle { DVNTLogoView(height: 16) }
            // Flat black. The container background was a washed brand gradient
            // behind every row — a section background, which the design system
            // rules out outright, and on OLED it lights pixels for nothing.
            .containerBackground(DVNT.canvas, for: .navigation)
        }
        .onAppear { connectivity.requestSync() }
    }

    private func rowBackground(_ group: EventGroup) -> some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(Color.white.opacity(0.06))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(group.hasPresentable ? DVNT.accent.opacity(0.5) : Color.white.opacity(0.08),
                                  lineWidth: 1)
            )
    }
}

private struct EventRow: View {
    let group: EventGroup

    var body: some View {
        VStack(alignment: .leading, spacing: DVNT.Space.tight) {
            HStack {
                Text(group.title)
                    .font(DVNT.TypeScale.title())
                    .foregroundColor(.white)
                    .lineLimit(2)
                Spacer(minLength: DVNT.Space.snug)
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
            .background(Capsule().fill(active ? Color.white : Color.white.opacity(0.15)))
    }
}

/// Home-list entry into the host-broadcast history, with an unread badge.
private struct BroadcastsEntryRow: View {
    let unread: Int
    var body: some View {
        HStack(spacing: DVNT.Space.base) {
            Image(systemName: "megaphone.fill")
                .font(.system(size: 15))
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

private struct StalenessRow: View {
    let syncedAt: Date
    let reachable: Bool
    var body: some View {
        HStack(spacing: DVNT.Space.snug) {
            Image(systemName: reachable ? "checkmark.circle" : "iphone.slash")
                .font(.system(size: 13))
            Text(reachable ? "Live" : "As of \(syncedAt.formatted(date: .omitted, time: .shortened))")
                .font(DVNT.TypeScale.caption(13))
        }
        .foregroundColor(DVNT.textFaint)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

private struct EmptyTicketsView: View {
    let reachable: Bool
    var body: some View {
        ZStack {
            DVNT.canvas.ignoresSafeArea()
            VStack(spacing: DVNT.Space.roomy) {
                DVNTLogoView(height: 22)
                Image(systemName: "ticket")
                    .font(.system(size: 28))
                    .foregroundColor(DVNT.accent)
                Text("No tickets yet")
                    .font(DVNT.TypeScale.title())
                    .foregroundColor(.white)
                Text(reachable ? "Buy on your iPhone — they appear here."
                               : "Open DVNT on your iPhone to sync.")
                    .font(DVNT.TypeScale.body())
                    .foregroundColor(DVNT.textDim)
                    .multilineTextAlignment(.center)
            }
            .padding()
        }
    }
}
