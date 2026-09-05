import SwiftUI

private struct QuickActionDestination: Identifiable {
    let id = UUID()
    let action: String
    let ticketId: String?
    let eventId: String?
    let error: String?
}
private struct WatchQuickActions: ViewModifier {
    @Environment(\.scenePhase) private var phase
    @Environment(DMStore.self) private var messages
    @Environment(CallStore.self) private var calls
    @Environment(ActiveCallStore.self) private var activeCall
    @Environment(VenueActionStore.self) private var venue
    @EnvironmentObject private var tickets: TicketStore
    @State private var destination: QuickActionDestination?
    func body(content: Content) -> some View {
        content.onAppear { consume() }
            .onChange(of: phase) { _, phase in if phase == .active { consume() } }
            .onReceive(NotificationCenter.default.publisher(for: Notification.Name("DVNTWatchQuickAction"))) { _ in consume() }
            .onChange(of: messages.envelope.accountGen) { _, _ in destination = nil }
            .sheet(item: $destination) { target in
                NavigationStack {
                    Group {
                        if let error = target.error { ContentUnavailableView(error, systemImage: "exclamationmark.circle") }
                        else if target.action == "ticket", let id = target.ticketId,
                                let group = tickets.groups.first(where: { $0.tickets.contains { $0.id == id } }) {
                            TicketStackView(group: group, initialTicketId: id)
                        } else if target.action == "presence", let eventId = target.eventId {
                            ScrollView {
                                VStack(alignment: .leading, spacing: DVNT.Space.base) {
                                    Text("Arrival status").font(DVNT.TypeScale.title())
                                    Text("Shared only with the host. No location is sent. This does not check you in.").font(DVNT.TypeScale.caption())
                                    if venue.sending.contains(eventId) { ProgressView("Confirming on phone…") }
                                    else { Text(venue.results[eventId]?.message ?? "Not confirmed. Open your pass to try again.").font(DVNT.TypeScale.body()) }
                                    if let ticketId = target.ticketId { Button("Stop sharing") { venue.presence(eventId: eventId, ticketId: ticketId, state: "revoke") }.disabled(venue.sending.contains(eventId)) }
                                }.padding(DVNT.Space.base)
                            }
                        } else if target.action == "mute" {
                            if activeCall.call != nil { ActiveCallView() }
                            else { ContentUnavailableView("No active phone call", systemImage: "phone.down") }
                        }
                        else { ContentUnavailableView("No current pass", systemImage: "ticket") }
                    }.toolbar { ToolbarItem(placement: .cancellationAction) { Button("Done") { destination = nil } } }
                }
            }
    }
    private func consume() {
        guard phase == .active, let defaults = UserDefaults(suiteName: "group.com.dvnt.app.watch"),
              let data = defaults.data(forKey: "dvnt.watch.quickAction") else { return }
        defaults.removeObject(forKey: "dvnt.watch.quickAction")
        guard let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let action = request["action"] as? String,
              let issuedAt = request["issuedAt"] as? Double, issuedAt.isFinite,
              issuedAt <= Date().timeIntervalSince1970 + 5, Date().timeIntervalSince1970 - issuedAt < 30,
              request["accountGen"] as? String == messages.envelope.accountGen,
              !messages.envelope.accountGen.isEmpty, calls.incoming == nil else {
            destination = QuickActionDestination(action: "", ticketId: nil, eventId: nil, error: "Action unavailable. Try again after syncing."); return
        }
        if action == "mute" {
            guard let call = activeCall.call, call.canMute, call.expiresAt > Date().timeIntervalSince1970 else {
                destination = QuickActionDestination(action: action, ticketId: nil, eventId: nil, error: "No active phone call"); return
            }
            activeCall.act("set_muted", muted: true)
            destination = QuickActionDestination(action: action, ticketId: nil, eventId: nil, error: nil)
            return
        }
        let now = Date()
        let ticket = tickets.envelope.tickets.filter { ticket in
            guard ticket.status.isPresentable else { return false }
            if let end = WatchEvent.date(ticket.eventEndDate), end <= now { return false }
            if let start = WatchEvent.date(ticket.eventDate), ticket.eventEndDate == nil, start.addingTimeInterval(8 * 3600) <= now { return false }
            return action != "presence" || ticket.isOwner == true
        }.sorted { ($0.eventDate ?? "") < ($1.eventDate ?? "") }.first
        guard let ticket else {
            destination = QuickActionDestination(action: action, ticketId: nil, eventId: nil, error: "No current pass. Sync with your phone."); return
        }
        if action == "presence" {
            guard let start = WatchEvent.date(ticket.eventDate), abs(start.timeIntervalSince(now)) <= 24 * 3600 else {
                destination = QuickActionDestination(action: action, ticketId: nil, eventId: nil, error: "Arrival sharing is for event day."); return
            }
            venue.presence(eventId: ticket.eventId, ticketId: ticket.id, state: "arrived")
        }
        destination = QuickActionDestination(action: action, ticketId: ticket.id, eventId: ticket.eventId, error: nil)
    }
}
extension View {
    func watchQuickActions() -> some View { modifier(WatchQuickActions()) }
}
