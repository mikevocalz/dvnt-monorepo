import Foundation

/// The compact ticket DTO the phone pushes over WCSession and persists into the
/// watch App Group. Mirrors `packages/app/src/watch/watch-payload.ts` — keep the
/// two in lockstep. `qrToken` is the EXACT string the host scanner expects
/// (64-char hex), rendered byte-identical to the phone (see docs/watch-app-fit.md).
struct WatchTicket: Identifiable, Codable, Hashable {
    let id: String
    let eventId: String
    let qrToken: String
    let status: TicketStatus

    let tier: String?
    let tierName: String?
    let tableNumber: String?
    let checkedInAt: String?

    // Denormalised event snapshot so the watch is glanceable + offline-capable.
    let eventTitle: String
    let eventDate: String?      // ISO8601
    let eventEndDate: String?   // ISO8601
    let eventLocation: String?
    let entryWindow: String?

    enum CodingKeys: String, CodingKey {
        case id, eventId, qrToken, status, tier, tierName, tableNumber
        case checkedInAt, eventTitle, eventDate, eventEndDate, eventLocation, entryWindow
    }

    /// Lenient decode — the bridge maps the DB `scanned` to `checked_in`, but be
    /// defensive about either reaching us.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        eventId = try c.decode(String.self, forKey: .eventId)
        qrToken = (try? c.decode(String.self, forKey: .qrToken)) ?? ""
        let raw = (try? c.decode(String.self, forKey: .status)) ?? "valid"
        status = TicketStatus(rawValue: raw) ?? .valid
        tier = try? c.decode(String.self, forKey: .tier)
        tierName = try? c.decode(String.self, forKey: .tierName)
        tableNumber = try? c.decode(String.self, forKey: .tableNumber)
        checkedInAt = try? c.decode(String.self, forKey: .checkedInAt)
        eventTitle = (try? c.decode(String.self, forKey: .eventTitle)) ?? "Event"
        eventDate = try? c.decode(String.self, forKey: .eventDate)
        eventEndDate = try? c.decode(String.self, forKey: .eventEndDate)
        eventLocation = try? c.decode(String.self, forKey: .eventLocation)
        entryWindow = try? c.decode(String.self, forKey: .entryWindow)
    }
}

/// Mirrors `TicketStatus` in `packages/app/lib/stores/ticket-store.ts`. The DB's
/// `scanned` is normalised to `checked_in` upstream, but we accept both.
enum TicketStatus: String, Codable {
    case valid
    case checkedIn = "checked_in"
    case scanned            // raw DB value, normalised to checkedIn behaviour
    case revoked
    case expired
    case transferPending = "transfer_pending"

    /// Only a `valid` ticket should present a live, scannable code.
    var isPresentable: Bool { self == .valid }

    var isUsed: Bool { self == .checkedIn || self == .scanned }

    var displayLabel: String {
        switch self {
        case .valid: return "Valid"
        case .checkedIn, .scanned: return "Checked In"
        case .revoked: return "Revoked"
        case .expired: return "Expired"
        case .transferPending: return "Transferring"
        }
    }
}

/// A run of tickets for one event — the unit of the home list.
struct EventGroup: Identifiable {
    let id: String           // eventId
    let title: String
    let date: Date?
    let location: String?
    let tickets: [WatchTicket]

    var count: Int { tickets.count }
    var hasPresentable: Bool { tickets.contains { $0.status.isPresentable } }
}

/// The whole payload the phone sends, with a sync timestamp for honest staleness.
struct WatchTicketEnvelope: Codable {
    let tickets: [WatchTicket]
    let syncedAt: Double      // epoch seconds (sent by the phone — watch clock-safe)

    static let empty = WatchTicketEnvelope(tickets: [], syncedAt: 0)
}
