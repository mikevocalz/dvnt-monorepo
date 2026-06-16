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
                                    .fill(DVNT.brandGradient.opacity(0.22))
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
            .navigationTitle("")
            .toolbar {
                ToolbarItem(placement: .principal) { DVNTLogoView(height: 16) }
            }
            .containerBackground(DVNT.brandGradient.opacity(0.18), for: .navigation)
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
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(group.title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundColor(.white)
                    .lineLimit(1)
                Spacer(minLength: 6)
                CountBadge(count: group.count, active: group.hasPresentable)
            }
            if let date = group.date {
                Text(date.formatted(date: .abbreviated, time: .shortened))
                    .font(.system(size: 12))
                    .foregroundColor(.white.opacity(0.6))
            }
            if let loc = group.location, !loc.isEmpty {
                Text(loc)
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.4))
                    .lineLimit(1)
            }
        }
        .padding(.vertical, 4)
    }
}

private struct CountBadge: View {
    let count: Int
    let active: Bool
    var body: some View {
        Text("\(count)")
            .font(.system(size: 12, weight: .bold))
            .foregroundColor(active ? .black : .white)
            .frame(minWidth: 18, minHeight: 18)
            .padding(.horizontal, 4)
            .background(
                Capsule().fill(active ? AnyShapeStyle(DVNT.brandGradient) : AnyShapeStyle(Color.white.opacity(0.15)))
            )
    }
}

/// Home-list entry into the host-broadcast history, with an unread badge.
private struct BroadcastsEntryRow: View {
    let unread: Int
    var body: some View {
        HStack(spacing: 8) {
            Image(systemName: "megaphone.fill")
                .font(.system(size: 14))
                .foregroundColor(.white)
            Text("Messages from host")
                .font(.system(size: 14, weight: .semibold))
                .foregroundColor(.white)
                .lineLimit(1)
            Spacer(minLength: 4)
            if unread > 0 {
                Text("\(unread)")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundColor(.black)
                    .frame(minWidth: 18, minHeight: 18)
                    .padding(.horizontal, 4)
                    .background(Capsule().fill(Color.white))
            }
        }
        .padding(.vertical, 4)
    }
}

private struct StalenessRow: View {
    let syncedAt: Date
    let reachable: Bool
    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: reachable ? "checkmark.circle" : "iphone.slash")
                .font(.system(size: 10))
            Text(reachable ? "Live" : "As of \(syncedAt.formatted(date: .omitted, time: .shortened))")
                .font(.system(size: 10))
        }
        .foregroundColor(.white.opacity(0.4))
        .frame(maxWidth: .infinity)
    }
}

private struct EmptyTicketsView: View {
    let reachable: Bool
    var body: some View {
        ZStack {
            DVNT.canvas.ignoresSafeArea()
            VStack(spacing: 10) {
                DVNTLogoView(height: 22)
                Image(systemName: "ticket")
                    .font(.system(size: 26))
                    .foregroundStyle(DVNT.brandGradient)
                Text("No tickets yet")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                Text(reachable ? "Buy on your iPhone — they appear here."
                               : "Open DVNT on your iPhone to sync.")
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.5))
                    .multilineTextAlignment(.center)
            }
            .padding()
        }
    }
}
