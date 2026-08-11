import SwiftUI
import WatchKit

/// One event, N tickets. A full-screen swipeable/Crown-paged stack — one QR per
/// page (never two QRs on a screen). "1 of 3" indicator, per-ticket tier label.
struct TicketStackView: View {
    let group: EventGroup
    @State private var index = 0

    var body: some View {
        TabView(selection: $index) {
            ForEach(Array(group.tickets.enumerated()), id: \.element.id) { i, ticket in
                TicketPage(ticket: ticket,
                           position: i + 1,
                           total: group.tickets.count,
                           eventTitle: group.title)
                    .tag(i)
            }
        }
        // Vertical paging = Digital Crown pages through the ticket stack (watchOS-native).
        .tabViewStyle(.verticalPage)
        .background(DVNT.canvas.ignoresSafeArea())
        .navigationTitle(group.tickets.count > 1 ? "\(index + 1) of \(group.tickets.count)" : "Ticket")
        .onChange(of: index) {
            DVNT.Haptic.page()
        }
        .onAppear {
            DVNT.Haptic.enter()
        }
    }
}

/// A single full-bleed ticket page: card-flip into the QR, brightness-maximised
/// white field, state overlays mirroring the ticket state machine.
private struct TicketPage: View {
    let ticket: WatchTicket
    let position: Int
    let total: Int
    let eventTitle: String

    @EnvironmentObject private var broadcasts: BroadcastStore
    @EnvironmentObject private var store: TicketStore
    @State private var flipped = false

    /// HIG W-AC-04: the card-flip is decorative. Honour Reduce Motion by
    /// presenting the pass already turned rather than animating into it.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var accent: Color { DVNT.tierAccent(ticket.tier) }

    var body: some View {
        ScrollView {
            VStack(spacing: DVNT.Space.base) {
                // Tier / guest label per ticket.
                HStack(spacing: DVNT.Space.snug) {
                    Circle().fill(accent).frame(width: 8, height: 8)
                    Text((ticket.tierName ?? ticket.tier?.capitalized ?? "General").uppercased())
                        .font(DVNT.TypeScale.stamp(14))
                        .tracking(DVNT.TypeScale.stampTracking)
                        .foregroundColor(.white)
                        .lineLimit(1)
                    if let table = ticket.tableNumber, !table.isEmpty {
                        Text("· \(table)")
                            .font(DVNT.TypeScale.stamp(14))
                            .foregroundColor(DVNT.textBright)
                    }
                }
                .padding(.top, DVNT.Space.hair)
                .accessibilityElement(children: .combine)

                Text(eventTitle)
                    .font(DVNT.TypeScale.caption())
                    .foregroundColor(DVNT.textDim)
                    .lineLimit(1)

                qrZone

                statusLine

                ownershipStamp

                doorPerks

                hostMessagesLink
            }
            .padding(.horizontal, DVNT.Space.base)
            .padding(.bottom, DVNT.Space.roomy)
        }
        .onAppear {
            if reduceMotion {
                flipped = true
            } else {
                withAnimation(DVNT.Motion.enter) { flipped = true }
            }
        }
    }

    /// The ring is sized from the real screen, not a constant. A 150pt card was
    /// tuned on one watch and left every other size wrong — on 45/49mm it wasted
    /// a third of the width, which on a pass screen is scan distance thrown away.
    private var ringDiameter: CGFloat {
        min(WKInterfaceDevice.current().screenBounds.width - 20, 184)
    }

    /// The white scan card is inscribed at 80% — its corners cross the ring's
    /// inner edge, so the code reads as a stub punched through the ring rather
    /// than a square politely parked inside a circle.
    private var cardSide: CGFloat { ringDiameter * 0.80 }

    @ViewBuilder private var qrZone: some View {
        AccessRing(phase: RingPhase.of(ticket), tint: accent, diameter: ringDiameter) {
            ZStack {
                RoundedRectangle(cornerRadius: DVNT.Radius.card, style: .continuous)
                    .fill(Color.white)

                if ticket.status.isPresentable {
                    QRCodeView(matrix: ticket.qrMatrix, size: cardSide - 12)
                } else {
                    // Blocked: do NOT present a scannable code for a dead ticket.
                    blockedOverlay
                }
            }
            .frame(width: cardSide, height: cardSide)
            .rotation3DEffect(.degrees(flipped ? 0 : 90), axis: (x: 0, y: 1, z: 0))
        }
    }

    @ViewBuilder private var blockedOverlay: some View {
        VStack(spacing: DVNT.Space.base) {
            switch ticket.status {
            case .checkedIn, .scanned:
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: DVNT.TypeScale.Icon.hero)).foregroundColor(DVNT.accent)
                Text("Checked In").font(DVNT.TypeScale.body()).foregroundColor(.black)
            case .revoked:
                Image(systemName: "xmark.octagon.fill")
                    .font(.system(size: DVNT.TypeScale.Icon.hero)).foregroundColor(Color(hex: 0xFC253A))
                Text("Revoked").font(DVNT.TypeScale.body()).foregroundColor(.black)
            case .expired:
                Image(systemName: "lock.fill")
                    .font(.system(size: DVNT.TypeScale.Icon.hero)).foregroundColor(.gray)
                Text("Expired").font(DVNT.TypeScale.body()).foregroundColor(.black)
            case .transferPending:
                Image(systemName: "arrow.left.arrow.right")
                    .font(.system(size: DVNT.TypeScale.Icon.hero)).foregroundColor(DVNT.accent)
                Text("Transferring").font(DVNT.TypeScale.body()).foregroundColor(.black)
            case .valid:
                EmptyView()
            }
        }
    }

    /// The ring's own caption. `.everyMinute` rather than a per-second tick: a
    /// countdown that updates 60× more often than it visibly changes is pure
    /// battery, and watchOS coalesces the minute schedule with the system clock.
    @ViewBuilder private var statusLine: some View {
        if ticket.status.isUsed, let at = ticket.checkedInAt.flatMap(TicketStore.parseDate) {
            Text("Checked in \(at.formatted(date: .omitted, time: .shortened))")
                .font(DVNT.TypeScale.caption())
                .foregroundColor(DVNT.textDim)
        } else if ticket.status.isPresentable {
            TimelineView(.everyMinute) { ctx in
                let phase = RingPhase.of(ticket, now: ctx.date)
                Text(caption(for: phase, now: ctx.date))
                    .font(DVNT.TypeScale.stamp())
                    .tracking(DVNT.TypeScale.stampTracking)
                    .foregroundColor(phase == .open ? accent : .white)
            }
        }
    }

    private func caption(for phase: RingPhase, now: Date) -> String {
        switch phase {
        case .open: return "DOORS OPEN"
        case .admitted: return "CHECKED IN"
        case .blocked: return ticket.status.displayLabel.uppercased()
        case .scheduled: return "PRESENT AT DOOR"
        case .approaching:
            guard let doors = ticket.eventDate.flatMap(TicketStore.parseDate) else {
                return "PRESENT AT DOOR"
            }
            let mins = max(Int(doors.timeIntervalSince(now) / 60), 0)
            return mins >= 60
                ? "DOORS IN \(mins / 60)H \(mins % 60)M"
                : "DOORS IN \(mins)M"
        }
    }

    /// Honest about whose pass this is. A code held under someone else's account
    /// still scans, but the wearer should know before the door tells them.
    @ViewBuilder private var ownershipStamp: some View {
        if ticket.isOwner == false {
            Label("HELD FOR YOU", systemImage: "person.crop.square")
                .font(DVNT.TypeScale.stamp())
                .tracking(DVNT.TypeScale.stampTracking)
                .foregroundColor(DVNT.textDim)
        }
    }

    /// Resolved entitlement, as decided by the phone's resolver from Supabase —
    /// not a plan name the watch pattern-matched into perks. Only shown for a
    /// pass that can still get someone in; there is no door to skip afterwards.
    @ViewBuilder private var doorPerks: some View {
        if ticket.status.isPresentable,
           let perks = store.membership?.doorPerks, !perks.isEmpty {
            VStack(alignment: .leading, spacing: DVNT.Space.tight) {
                ForEach(perks, id: \.label) { perk in
                    Label(perk.label, systemImage: perk.symbol)
                        .font(DVNT.TypeScale.stamp())
                        .tracking(DVNT.TypeScale.stampTracking)
                        .foregroundStyle(DVNT.brandGradient)
                }
            }
            .padding(.top, DVNT.Space.tight)
            .accessibilityElement(children: .combine)
            .accessibilityLabel("Included with your membership: "
                + perks.map(\.label).joined(separator: ", "))
        }
    }

    /// Scroll below the QR to reach this event's host messages (the QR stays the
    /// hero; messages are one crown-scroll away — never crowding the code).
    @ViewBuilder private var hostMessagesLink: some View {
        let count = broadcasts.broadcasts(forEvent: ticket.eventId).count
        if count > 0 {
            NavigationLink {
                BroadcastListView(eventId: ticket.eventId)
            } label: {
                HStack(spacing: DVNT.Space.snug) {
                    Image(systemName: "megaphone.fill").font(.system(size: DVNT.TypeScale.Icon.row))
                    Text("Messages from host").font(DVNT.TypeScale.body())
                }
                .foregroundColor(.white)
                .padding(.vertical, DVNT.Space.base)
                .padding(.horizontal, DVNT.Space.roomy)
                .background(Capsule().fill(DVNT.brandGradient.opacity(0.30)))
            }
            .buttonStyle(.plain)
            .padding(.top, DVNT.Space.snug)
            .accessibilityLabel(count == 1
                ? "1 message from the host"
                : "\(count) messages from the host")
        }
    }
}
