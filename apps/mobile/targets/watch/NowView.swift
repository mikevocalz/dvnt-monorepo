import SwiftUI

/// The launch page keeps the ticket action directly below its Door header.
/// Ticket data can be cached; StalenessFooter reports its age independently.
struct NowView: View {
    @Environment(EventStore.self) private var events
    @EnvironmentObject private var store: TicketStore
    @EnvironmentObject private var doors: DoorStore
    @EnvironmentObject private var connectivity: WatchConnectivityManager

    private var nextEvent: WatchEvent? {
        events.events.filter { $0.status == "active" && $0.section() != "Past" && ($0.inviteStatus == "pending" || $0.rsvp == "going" || $0.rsvp == "interested" || $0.saved || $0.host || !$0.waitlist.isEmpty) }
            .sorted { ($0.startsAt ?? .distantFuture) < ($1.startsAt ?? .distantFuture) }.first
    }

    var body: some View {
        GeometryReader { geometry in
            ScrollView {
                VStack(alignment: .leading, spacing: DVNT.Space.base) {
                    DoorHeader(
                        art: store.focus.map { .event(imageURL: $0.imageURL, dominantHex: $0.dominantHex) } ?? nextEvent?.imageURL.map { .event(imageURL: $0, dominantHex: nil) } ?? .none,
                        title: "Now",
                        stub: store.nowStub,
                        showsWordmark: true,
                        minimumHeight: geometry.size.height * 0.4
                    )
                    if let group = store.tonight.first {
                        HeroCard(group: group, isTonight: true)
                    } else if let next = store.upcoming.first {
                        HeroCard(group: next, isTonight: false)
                    } else if let event = nextEvent {
                        VStack(alignment: .leading, spacing: DVNT.Space.base) {
                            Text(event.title).font(DVNT.TypeScale.title()).lineLimit(2)
                            Text(event.stateLabel).font(DVNT.TypeScale.caption()).foregroundStyle(DVNT.textBright)
                            if let start = event.startsAt {
                                Text(start.formatted(.dateTime.weekday().month().day().hour().minute()))
                                    .font(DVNT.TypeScale.body())
                            }
                            NavigationLink { EventDetailView(eventId: event.id) } label: {
                                Label(event.inviteStatus == "pending" ? "View invitation" : "View event", systemImage: "calendar")
                                    .font(DVNT.TypeScale.body()).frame(maxWidth: .infinity, minHeight: 44)
                            }.buttonStyle(.borderedProminent).tint(DVNT.accent).foregroundStyle(.black)
                            SnapshotFreshness(label: "Events", syncedAt: events.syncedAt)
                        }.padding(DVNT.Space.roomy)
                            .background(cardBackground(fill: DVNT.Surface.low, stroke: DVNT.hairline))
                    } else {
                        NothingTonight()
                    }
                    if let d = doors.door {
                        NavigationLink {
                            DoorView()
                        } label: {
                            DoorEntryRow(arrived: d.arrived, remaining: d.remaining)
                        }
                        .buttonStyle(.plain)
                        .padding(DVNT.Space.roomy)
                        .background(cardBackground(fill: DVNT.Surface.low, stroke: DVNT.hairline))
                    }
                    StalenessFooter()
                }
                .padding(.horizontal, DVNT.Space.base)
                .padding(.bottom, DVNT.Space.loose)
            }
        }
        .navigationDestination(for: String.self) { id in
            if let group = store.groups.first(where: { $0.id == id }) {
                TicketStackView(group: group)
            } else {
                ContentUnavailableView("Ticket unavailable", systemImage: "ticket")
            }
        }
        .navigationTitle("Now")
        .containerBackground(DVNT.canvas, for: .navigation)
        .onAppear { connectivity.requestSync() }
    }
}

// MARK: - Hero

private struct HeroCard: View {
    let group: EventGroup
    /// Tonight leads with a countdown; anything further out leads with the day,
    /// because "3d 4h" is not how a member thinks about next Friday.
    let isTonight: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: DVNT.Space.base) {
            Text(group.title)
                .font(DVNT.TypeScale.title())
                .foregroundColor(.white)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            if group.hasPresentable {
                NavigationLink(value: group.id) {
                    HStack(spacing: DVNT.Space.snug) {
                        LiveDot()
                        Text("Show ticket")
                            .font(DVNT.TypeScale.body())
                            .foregroundColor(.black)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                    .background(Capsule().fill(.white))
                }
                .buttonStyle(.plain)
                .simultaneousGesture(TapGesture().onEnded { DVNT.Haptic.enter() })
                .accessibilityLabel("Show ticket for \(group.title)")
            } else {
                // Honest: there is a ticket record but nothing presentable. Say
                // so rather than offering a button that opens a dead pass.
                Text("No live pass for this event")
                    .font(DVNT.TypeScale.caption())
                    .foregroundColor(DVNT.textFaint)
            }
            if let date = group.date {
                if isTonight {
                    DoorsCountdown(doorsAt: date)
                } else {
                    Text(date.formatted(.dateTime.weekday(.wide).month().day()))
                        .font(DVNT.TypeScale.title())
                        .foregroundColor(.white)
                }
            }

            if let loc = group.location, !loc.isEmpty {
                Label(loc, systemImage: "mappin.and.ellipse")
                    .font(DVNT.TypeScale.caption())
                    .foregroundColor(DVNT.textDim)
                    .lineLimit(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(DVNT.Space.base)
        .background {
            ZStack {
                // Full-bleed flyer behind the hero, at the larger hero radius.
                // Falls back to the event's dominantHex, which is offline-safe.
                EventArt(group: group, cornerRadius: DVNT.Radius.hero)

                // Heavier scrim than the list rows carry: the hero stacks a
                // countdown, a venue and a CTA over the art, so it needs more
                // headroom to stay legible than a two-line row does. Neutral
                // black, not the brand gradient.
                LinearGradient(
                    colors: [.black.opacity(0.45), .black.opacity(0.82)],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .clipShape(RoundedRectangle(cornerRadius: DVNT.Radius.hero, style: .continuous))
            }
        }
        .overlay(
            RoundedRectangle(cornerRadius: DVNT.Radius.hero, style: .continuous)
                .strokeBorder(
                    group.hasPresentable ? DVNT.accent.opacity(0.55) : DVNT.Surface.hairline,
                    lineWidth: 1
                )
        )
    }
}

// MARK: - Empty

private struct NothingTonight: View {
    @EnvironmentObject private var store: TicketStore

    var body: some View {
        VStack(alignment: .leading, spacing: DVNT.Space.base) {
            Text(store.syncedAt == nil ? "Tickets not synced" : "No upcoming ticket")
                .font(DVNT.TypeScale.title())
            Text(store.syncedAt == nil
                 ? "Open DVNT on your iPhone to sync your tickets."
                 : "Swipe to Inbox for conversations and host notices.")
                .font(DVNT.TypeScale.body())
        }
        .fixedSize(horizontal: false, vertical: true)
    }
}
