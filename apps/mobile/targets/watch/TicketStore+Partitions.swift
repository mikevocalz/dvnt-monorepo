import Foundation

/// Time partitions for the sectioned events list and the Now hero.
///
/// Pure derivation from `groups` — no new payload, no new state. Kept in its own
/// file so the transport/persistence core in `TicketStore.swift` stays about the
/// wire and the App Group, not about presentation.
///
/// The whole point is that "tonight" is a privileged position. A ticketing app
/// that shows tonight's door in the same uniform stream as a show three months
/// out has made the member do the sorting, on a 40mm screen, in a dark room.
extension TicketStore {

    /// When an event is over. `eventEndDate` when the phone sent one; otherwise
    /// the start, which makes a dateless or just-started event sort as current
    /// rather than silently falling into Past.
    nonisolated static func endDate(of group: EventGroup) -> Date? {
        let ends = group.tickets.compactMap { $0.eventEndDate.flatMap(Self.parseDate) }
        return ends.max() ?? group.date
    }

    /// Ended. Checked against the *end*, so a member standing inside a running
    /// event never sees their live pass filed under Past.
    var past: [EventGroup] {
        let now = Date()
        return groups.filter { g in
            guard let end = Self.endDate(of: g) else { return false }
            return end < now
        }
    }

    /// Today, by the wearer's calendar day — not "within 24 hours". A member
    /// checks the wrist at 11pm and means *tonight*, and an event at 00:30
    /// tomorrow is not tonight even though it is 90 minutes away.
    var tonight: [EventGroup] {
        let cal = Calendar.current
        let now = Date()
        return groups.filter { g in
            guard let date = g.date else { return false }
            guard cal.isDateInToday(date) else { return false }
            // A show that already ended today belongs in Past, not the hero.
            if let end = Self.endDate(of: g), end < now { return false }
            return true
        }
    }

    /// Everything still to come after today. A group with no date lands here
    /// rather than being dropped — unknown is not the same as over, and a
    /// silently missing ticket is the one failure this app cannot have.
    var upcoming: [EventGroup] {
        let cal = Calendar.current
        let now = Date()
        return groups.filter { g in
            guard let date = g.date else { return true }
            if cal.isDateInToday(date) {
                // Ended earlier today → Past, handled above. Still running → tonight.
                return false
            }
            if let end = Self.endDate(of: g), end < now { return false }
            return date > now
        }
    }

    /// What the Now tab leads with: tonight if there is one, else the next thing.
    var focus: EventGroup? { tonight.first ?? upcoming.first }
}

// MARK: - Marquee stubs
//
// The ticket-stub voice in the chrome (Space Mono, uppercase) — "3 TONIGHT",
// "DOORS 21:00", "2 UPCOMING". Computed here rather than in the view so the
// menu and the destinations cannot disagree about what tonight looks like.
extension TicketStore {
    /// Doors are open when the focus event has started AND still has a pass that
    /// can be presented. Both halves matter: a started event whose tickets are
    /// all scanned is not "live" for this member any more.
    var isDoorsOpen: Bool {
        guard let g = focus, let date = g.date else { return false }
        return date <= Date() && g.hasPresentable
    }

    /// Before doors: the time they open. After doors: how many passes are live.
    var nowStub: String? {
        guard let g = focus else { return nil }
        if let date = g.date, date > Date() {
            let f = DateFormatter()
            f.locale = Locale(identifier: "en_US_POSIX")
            f.dateFormat = "HH:mm"
            return "DOORS \(f.string(from: date))"
        }
        let n = g.tickets.filter { $0.status.isPresentable }.count
        return n > 0 ? "\(n) LIVE" : nil
    }

    var ticketStub: String? {
        let n = groups.reduce(0) { $0 + $1.count }
        return n > 0 ? "\(n) TICKET\(n == 1 ? "" : "S")" : nil
    }

    var upcomingStub: String? {
        let n = upcoming.count
        return n > 0 ? "\(n) UPCOMING" : nil
    }
}
