import SwiftUI

struct VenuePresenceView: View {
    let eventId: String
    let ticketId: String
    @Environment(VenueActionStore.self) private var store
    @Environment(EventStore.self) private var events
    var body: some View {
        VStack(alignment: .leading, spacing: DVNT.Space.snug) {
            if events.events.contains(where: { $0.id == eventId }) {
                NavigationLink("RSVP & event") { EventDetailView(eventId: eventId) }
            }
            Text("Share arrival status").font(DVNT.TypeScale.body())
            Text("Share only this status with the host. No location is sent. This does not check you in.")
                .font(DVNT.TypeScale.caption()).foregroundStyle(DVNT.textBright)
            ForEach(["approaching", "arrived", "departed", "revoke"], id: \.self) { state in
                Button(label(state)) { store.presence(eventId: eventId, ticketId: ticketId, state: state) }
                    .disabled(store.sending.contains(eventId))
            }
            VenueActionStatus(eventId: eventId)
        }
    }
    private func label(_ state: String) -> String {
        switch state { case "approaching": return "Approaching"; case "arrived": return "I’m here"; case "departed": return "I’ve left"; default: return "Stop sharing" }
    }
}
struct VenueNoticeView: View {
    let eventId: String
    @Environment(VenueActionStore.self) private var store
    @Environment(\.isLuminanceReduced) private var dimmed
    @State private var audience = "all"
    @State private var confirmNew = false
    private var uncertain: Bool { store.commands[eventId]?.action == "notice" && store.results[eventId]?.status == "uncertain" }
    var body: some View {
        Group {
            if dimmed { Text("Raise to write notice") }
            else {
                ScrollView {
                    VStack(alignment: .leading, spacing: DVNT.Space.base) {
                        Text("Attendee notice").font(DVNT.TypeScale.title())
                        Text("Only event owners and accepted admin co-organizers can send.").font(DVNT.TypeScale.caption())
                        Picker("Audience", selection: $audience) {
                            Text("All attendees").tag("all")
                            Text("Checked in").tag("scanned")
                            Text("Not checked in").tag("unscanned")
                        }
                        TextFieldLink("Write notice") { store.drafts[eventId] = $0 }
                        if let draft = store.drafts[eventId], !draft.isEmpty {
                            Text(draft).font(DVNT.TypeScale.body()).privacySensitive()
                            Text("\(draft.utf16.count)/400").font(DVNT.TypeScale.caption())
                            Button("Send notice") { store.notice(eventId: eventId, audience: audience) }
                                .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || draft.utf16.count > 400 || store.sending.contains(eventId) || uncertain)
                        }
                        VenueActionStatus(eventId: eventId)
                        if uncertain {
                            Button("New notice") { confirmNew = true }
                        }
                    }.padding(DVNT.Space.base)
                }
            }
        }
        .navigationTitle("Send notice")
        .confirmationDialog("Check your phone first. The previous notice may have been sent.", isPresented: $confirmNew) {
            Button("Compose a new notice") { store.newNotice(eventId) }
        }
    }
}
private struct VenueActionStatus: View {
    let eventId: String
    @Environment(VenueActionStore.self) private var store
    var body: some View {
        if store.sending.contains(eventId) { ProgressView("Sending…") }
        else if let result = store.results[eventId] { Text(result.message).font(DVNT.TypeScale.caption()) }
    }
}
