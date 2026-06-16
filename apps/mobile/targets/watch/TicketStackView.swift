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
        .onChange(of: index) { _ in
            WKInterfaceDevice.current().play(.click)
        }
        .onAppear {
            WKInterfaceDevice.current().play(.start)
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
    @State private var flipped = false

    private var accent: Color { DVNT.tierAccent(ticket.tier) }

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                // Tier / guest label per ticket.
                HStack(spacing: 6) {
                    Circle().fill(accent).frame(width: 7, height: 7)
                    Text(ticket.tierName ?? ticket.tier?.capitalized ?? "General")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white)
                    if let table = ticket.tableNumber, !table.isEmpty {
                        Text("· \(table)")
                            .font(.system(size: 12))
                            .foregroundColor(.white.opacity(0.6))
                    }
                }
                .padding(.top, 2)

                Text(eventTitle)
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.55))
                    .lineLimit(1)

                qrZone
                    .padding(.vertical, 4)

                statusLine

                hostMessagesLink
            }
            .padding(.horizontal, 8)
            .padding(.bottom, 10)
        }
        .onAppear {
            withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) { flipped = true }
        }
    }

    @ViewBuilder private var qrZone: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.white)

            if ticket.status.isPresentable {
                QRCodeView(token: ticket.qrToken, size: 124)
                    .padding(6)
            } else {
                // Blocked: do NOT present a scannable code for a dead ticket.
                blockedOverlay
            }
        }
        .frame(width: 150, height: 150)
        .rotation3DEffect(.degrees(flipped ? 0 : 90), axis: (x: 0, y: 1, z: 0))
        .shadow(color: accent.opacity(ticket.status.isPresentable ? 0.45 : 0), radius: 10)
    }

    @ViewBuilder private var blockedOverlay: some View {
        VStack(spacing: 8) {
            switch ticket.status {
            case .checkedIn, .scanned:
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 34)).foregroundColor(DVNT.accent)
                Text("Checked In").font(.system(size: 13, weight: .semibold)).foregroundColor(.black)
            case .revoked:
                Image(systemName: "xmark.octagon.fill")
                    .font(.system(size: 34)).foregroundColor(Color(hex: 0xFC253A))
                Text("Revoked").font(.system(size: 13, weight: .semibold)).foregroundColor(.black)
            case .expired:
                Image(systemName: "lock.fill")
                    .font(.system(size: 34)).foregroundColor(.gray)
                Text("Expired").font(.system(size: 13, weight: .semibold)).foregroundColor(.black)
            case .transferPending:
                Image(systemName: "arrow.left.arrow.right")
                    .font(.system(size: 34)).foregroundColor(DVNT.accent)
                Text("Transferring").font(.system(size: 13, weight: .semibold)).foregroundColor(.black)
            case .valid:
                EmptyView()
            }
        }
    }

    @ViewBuilder private var statusLine: some View {
        if ticket.status.isPresentable {
            Text("PRESENT AT DOOR")
                .font(.system(size: 10, weight: .bold))
                .tracking(1.2)
                .foregroundColor(accent)
        } else if ticket.status.isUsed, let at = ticket.checkedInAt.flatMap(TicketStore.parseDate) {
            Text("Checked in \(at.formatted(date: .omitted, time: .shortened))")
                .font(.system(size: 10))
                .foregroundColor(.white.opacity(0.5))
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
                HStack(spacing: 6) {
                    Image(systemName: "megaphone.fill").font(.system(size: 11))
                    Text("Messages from host").font(.system(size: 12, weight: .semibold))
                }
                .foregroundColor(.white)
                .padding(.vertical, 6)
                .padding(.horizontal, 12)
                .background(Capsule().fill(DVNT.brandGradient.opacity(0.30)))
            }
            .buttonStyle(.plain)
            .padding(.top, 6)
        }
    }
}
