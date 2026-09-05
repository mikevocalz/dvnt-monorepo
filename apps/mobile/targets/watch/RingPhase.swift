import Foundation

/// What the ring is saying. Derived once from the ticket + the clock, never
/// stored — there is one source of truth for a ticket and it is the phone.
enum RingPhase: Equatable {
    /// Doors are within the last-24-hours window. `progress` is 0…1 toward open.
    case approaching(progress: Double)
    /// Doors are open now. Full ring, live sweep.
    case open
    /// Scanned in. Full ring, still — the job is done, stop spending battery.
    case admitted
    /// Revoked / expired. Dashed track, no brand stroke.
    case blocked
    /// Valid, but more than a day out (or no date at all). Full quiet ring.
    case scheduled

    var fraction: Double? {
        switch self {
        case .approaching(let p): return min(max(p, 0), 1)
        case .open, .admitted, .scheduled: return 1
        case .blocked: return nil
        }
    }

    var isBlocked: Bool { self == .blocked }

    /// Only a pass that could still get someone through a door earns motion.
    var animates: Bool {
        switch self {
        case .approaching, .open: return true
        case .admitted, .blocked, .scheduled: return false
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .approaching: return "Doors approaching"
        case .open: return "Doors are open"
        case .admitted: return "Checked in"
        case .blocked: return "Pass not valid"
        case .scheduled: return "Upcoming"
        }
    }

    /// The window over which `.approaching` fills. A day is the horizon in which
    /// a member actually starts checking their wrist for tonight.
    private static let window: TimeInterval = 24 * 60 * 60

    static func of(_ ticket: WatchTicket, now: Date = Date()) -> RingPhase {
        if ticket.status.isUsed { return .admitted }
        guard ticket.status.isPresentable else { return .blocked }

        guard let doors = ticket.eventDate.flatMap(TicketStore.parseDate) else {
            return .scheduled
        }
        let ends = ticket.eventEndDate.flatMap(TicketStore.parseDate)
            ?? doors.addingTimeInterval(8 * 60 * 60)

        if now >= ends { return .blocked }
        if now >= doors { return .open }

        let remaining = doors.timeIntervalSince(now)
        guard remaining <= window else { return .scheduled }
        return .approaching(progress: 1 - (remaining / window))
    }
}
