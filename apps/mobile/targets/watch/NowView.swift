import SwiftUI

/// The hero tab — the single most important thing this watch can answer, which
/// is "what am I doing tonight and how do I get in".
///
/// HIG W-NV-05: the primary action must be reachable within one tap of launch.
/// `Now` is the first tab, and *Show ticket* is one tap from a cold raise —
/// previously the same pass took a scroll through an undifferentiated list plus
/// a tap plus a Crown page.
///
/// HIG W-GL-01/W-GL-06: one piece of information leads. Everything else on this
/// screen is subordinate to the countdown and the pass.
struct NowView: View {
    @EnvironmentObject private var store: TicketStore
    @EnvironmentObject private var doors: DoorStore
    @EnvironmentObject private var connectivity: WatchConnectivityManager

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: DVNT.Space.roomy) {
                    if let group = store.tonight.first {
                        HeroCard(group: group, isTonight: true)
                    } else if let next = store.upcoming.first {
                        HeroCard(group: next, isTonight: false)
                    } else {
                        NothingTonight(reachable: connectivity.isReachable)
                    }

                    // Host mode. Only while an event is actually running, and
                    // deliberately below the member's own pass — a host is a
                    // member first, and their ticket is what gets them inside.
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
                }
                .padding(.horizontal, DVNT.Space.roomy)
                .padding(.bottom, DVNT.Space.loose)
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

// MARK: - Hero

private struct HeroCard: View {
    let group: EventGroup
    /// Tonight leads with a countdown; anything further out leads with the day,
    /// because "3d 4h" is not how a member thinks about next Friday.
    let isTonight: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: DVNT.Space.base) {
            Text(isTonight ? "TONIGHT" : "NEXT UP")
                .font(DVNT.TypeScale.stamp())
                .tracking(DVNT.TypeScale.stampTracking)
                .foregroundColor(DVNT.accent)

            Text(group.title)
                .font(DVNT.TypeScale.title(20))
                .foregroundColor(.white)
                .lineLimit(3)
                .fixedSize(horizontal: false, vertical: true)

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
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(DVNT.Space.roomy)
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
    let reachable: Bool

    var body: some View {
        ContentUnavailableView {
            Label("Nothing tonight", systemImage: "moon.stars")
                .font(DVNT.TypeScale.title())
        } description: {
            Text(reachable
                 ? "When you have a ticket, tonight's door shows up here."
                 : "Open DVNT on your iPhone to sync.")
                .font(DVNT.TypeScale.body())
        }
    }
}
