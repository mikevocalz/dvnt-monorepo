import SwiftUI

/// Root page content. RootTabs owns the navigation stacks; these lists own
/// Crown scrolling. The Door is always the first row, including empty states.
struct TicketsView: View {
    @EnvironmentObject private var store: TicketStore
    @EnvironmentObject private var connectivity: WatchConnectivityManager
    @SceneStorage("watch.rootEventId") private var eventId = ""
    private var selected: EventGroup? { store.groups.first { $0.id == eventId } ?? store.groups.first(where: \.hasPresentable) }
    var body: some View {
        Group {
            if let next = selected {
                TicketStackView(group: next)
            } else { TicketEventsView() }
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink { TicketEventsView() } label: { Image(systemName: "ticket") }
                    .accessibilityLabel("All tickets")
            }
        }
        .onAppear { if eventId.isEmpty { eventId = selected?.id ?? "" }; connectivity.requestSync() }
    }
}

private struct TicketEventsView: View {
    @EnvironmentObject private var store: TicketStore
    @EnvironmentObject private var connectivity: WatchConnectivityManager

    private var live: [EventGroup] { store.groups.filter(\.hasPresentable) }

    var body: some View {
        GeometryReader { geometry in
            List {
                DoorHeader(
                    art: live.first.map { .event(imageURL: $0.imageURL, dominantHex: $0.dominantHex) } ?? .none,
                    title: "Tickets",
                    stub: store.ticketStub,
                    minimumHeight: geometry.size.height * 0.4
                )
                if live.isEmpty {
                    EmptyTicketsView()
                        .listRowBackground(Color.clear)
                } else {
                    ForEach(live) { group in
                        NavigationLink(value: group.id) { EventRow(group: group) }
                            .listRowBackground(Color.clear)
                            .listRowInsets(EdgeInsets())
                    }
                }
                StalenessFooter()
            }
            .listStyle(.plain)
        }
        .navigationDestination(for: String.self) { id in
            if let group = store.groups.first(where: { $0.id == id }) {
                TicketStackView(group: group)
            } else {
                ContentUnavailableView("Ticket unavailable", systemImage: "ticket")
            }
        }
        .navigationTitle("Tickets")
        .containerBackground(DVNT.canvas, for: .navigation)
        .onAppear { connectivity.requestSync() }
    }
}

struct EventsView: View {
    @Environment(EventStore.self) private var store

    var body: some View {
        GeometryReader { geometry in
            List {
                DoorHeader(art: store.events.first(where: { $0.imageURL != nil && $0.section() != "Past" }).map {
                    .event(imageURL: $0.imageURL, dominantHex: nil)
                } ?? .none, title: "Events", stub: "INVITES · RSVP · SAVED", minimumHeight: geometry.size.height * 0.4)
                if let error = store.error {
                    Label(error, systemImage: "exclamationmark.circle").font(DVNT.TypeScale.body())
                        .listRowBackground(Color.clear)
                    Button("Retry sync") { store.requestSync?() }
                }
                if store.envelope.hasPrevious == true, let last = store.events.last {
                    Button("Previous events") { store.perform(eventId: last.id, action: "archive_previous") }
                        .disabled(store.pending[last.id] != nil)
                }
                if store.envelope.hasMore == true, let last = store.events.last {
                    Button("Next events") { store.perform(eventId: last.id, action: "archive_more") }
                        .disabled(store.pending[last.id] != nil)
                }
                if store.events.isEmpty && store.error == nil {
                    VStack(alignment: .leading, spacing: DVNT.Space.base) {
                        Text(store.syncedAt == nil ? "Events not synced" : "No events yet")
                            .font(DVNT.TypeScale.title())
                        Text("Invitations, RSVPs and saved events appear here — a ticket isn’t required.")
                            .font(DVNT.TypeScale.body())
                    }.listRowBackground(Color.clear)
                }
                ForEach(store.sections, id: \.self) { section in
                    let rows = store.events(in: section)
                    if !rows.isEmpty {
                        Section {
                            ForEach(rows) { event in
                                NavigationLink { EventDetailView(eventId: event.id) } label: {
                                    HStack(spacing: DVNT.Space.base) {
                                        EventArt(dominantHex: nil, imageURL: event.imageURL).frame(width: 44, height: 44)
                                        VStack(alignment: .leading, spacing: DVNT.Space.hair) {
                                            Text(event.title).font(DVNT.TypeScale.body()).lineLimit(2)
                                            Text(event.stateLabel).font(DVNT.TypeScale.caption()).foregroundStyle(DVNT.textBright)
                                        }
                                    }
                                }.listRowBackground(Color.clear)
                            }
                        } header: {
                            Text(section.uppercased()).font(DVNT.TypeScale.stamp())
                                .tracking(DVNT.TypeScale.stampTracking).foregroundStyle(DVNT.textBright)
                        }
                    }
                }
                SnapshotFreshness(label: "Events", syncedAt: store.syncedAt).listRowBackground(Color.clear)
                PhoneLinkStatus().listRowBackground(Color.clear)
            }.listStyle(.plain)
        }
        .navigationTitle("Events")
        .containerBackground(DVNT.canvas, for: .navigation)
        .onAppear { store.requestSync?() }
    }
}

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

struct MessagesView: View {
    @EnvironmentObject private var connectivity: WatchConnectivityManager
    @EnvironmentObject private var broadcasts: BroadcastStore
    @Environment(DMStore.self) private var dms

    @AppStorage("dvnt.inbox.filter") private var filter = "All"

    private var entries: [InboxEntry] {
        let conversations = dms.dms.filter { dm in
            if filter == "Requests" { return dm.category == "request" || dm.category == "spam" }
            return dm.category == "inbox" && (filter != "Unread" || dm.unread)
        }
        let notices = filter == "Requests" ? [] : broadcasts.broadcasts.filter { filter != "Unread" || !$0.read }
        let merged = notices.map(InboxEntry.broadcast) + conversations.map(InboxEntry.dm)
        return merged.sorted {
            if $0.sortKey == $1.sortKey { return $0.id < $1.id }
            return $0.sortKey > $1.sortKey
        }
    }

    private var unreadStub: String? {
        let count = broadcasts.unreadCount + dms.unreadCount
        return count > 0 ? "\(count) UNREAD" : nil
    }

    var body: some View {
        GeometryReader { geometry in
            List {
                DoorHeader(
                    art: .mosaic(dms.recentAvatarURLs),
                    title: "Inbox",
                    stub: unreadStub,
                    minimumHeight: geometry.size.height * 0.4
                )
                Picker("Show", selection: $filter) {
                    Text("All").tag("All")
                    Text("Unread").tag("Unread")
                    Text("Requests").tag("Requests")
                }.listRowBackground(Color.clear)
                if let error = dms.envelope.error {
                    VStack(alignment: .leading) {
                        Text(error).font(.caption).foregroundStyle(.secondary)
                        Button("Retry") { connectivity.requestSync() }
                    }.listRowBackground(Color.clear)
                }
                if entries.isEmpty {
                    EmptyMessagesView()
                        .listRowBackground(Color.clear)
                } else {
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
                VStack(alignment: .leading, spacing: DVNT.Space.base) {
                    SnapshotFreshness(label: "Conversations", syncedAt: dms.syncedAt)
                    SnapshotFreshness(label: "Host notices", syncedAt: broadcasts.syncedAt)
                    PhoneLinkStatus()
                }
                .listRowBackground(Color.clear)
            }
            .listStyle(.plain)
        }
        .navigationTitle("Inbox")
        .toolbar { ToolbarItem(placement: .topBarTrailing) { NavigationLink { CallDirectoryView() } label: { Image(systemName: "phone") }.accessibilityLabel("Calls") } }
        .containerBackground(DVNT.canvas, for: .navigation)
    }

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

/// Freshness is a snapshot timestamp; link availability never changes it.
struct StalenessFooter: View {
    @EnvironmentObject private var store: TicketStore

    var body: some View {
        VStack(alignment: .leading, spacing: DVNT.Space.base) {
            SnapshotFreshness(label: "Tickets", syncedAt: store.syncedAt)
            PhoneLinkStatus()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .listRowBackground(Color.clear)
    }
}

struct SnapshotFreshness: View {
    let label: String
    let syncedAt: Date?

    var body: some View {
        VStack(alignment: .leading, spacing: DVNT.Space.hair) {
            Text(label)
                .font(DVNT.TypeScale.caption())
            if let syncedAt {
                Text("As of \(syncedAt.formatted(date: .abbreviated, time: .shortened))")
                    .font(DVNT.TypeScale.caption())
            } else {
                Text("Not synced yet")
                    .font(DVNT.TypeScale.caption())
            }
        }
        .foregroundStyle(DVNT.textBright)
        .fixedSize(horizontal: false, vertical: true)
        .accessibilityElement(children: .combine)
    }
}

struct PhoneLinkStatus: View {
    @EnvironmentObject private var connectivity: WatchConnectivityManager

    var body: some View {
        Label(connectivity.isReachable ? "iPhone reachable" : "iPhone not reachable",
              systemImage: connectivity.isReachable ? "iphone" : "iphone.slash")
            .font(DVNT.TypeScale.caption())
            .foregroundStyle(DVNT.textBright)
            .fixedSize(horizontal: false, vertical: true)
    }
}

struct EmptyTicketsView: View {
    @EnvironmentObject private var store: TicketStore

    var body: some View {
        VStack(alignment: .leading, spacing: DVNT.Space.base) {
            Label(store.syncedAt == nil ? "Tickets not synced" : "No live tickets",
                  systemImage: "ticket")
                .font(DVNT.TypeScale.title())
            Text(store.syncedAt == nil
                 ? "Open DVNT on your iPhone to sync your tickets."
                 : "Your next pass appears here after it syncs from iPhone.")
                .font(DVNT.TypeScale.body())
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}

struct EmptyMessagesView: View {
    @Environment(DMStore.self) private var dms

    var body: some View {
        VStack(alignment: .leading, spacing: DVNT.Space.base) {
            Label(dms.syncedAt == nil ? "Inbox not synced" : "No messages yet", systemImage: "message")
                .font(DVNT.TypeScale.title())
            Text(dms.syncedAt == nil
                 ? "Open DVNT on your iPhone to sync conversations and host notices."
                 : "Conversations and host notices appear here after they sync.")
                .font(DVNT.TypeScale.body())
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}
