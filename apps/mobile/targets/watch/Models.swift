import Foundation

/// The QR module grid, encoded on the phone and shipped over the wire: watchOS has
/// no Core Image, so the watch draws the phone's own matrix rather than re-encoding
/// `qrToken`. Hex, row-major, 4 modules per character, most-significant bit first.
/// Mirrors `WatchQRMatrix` in `packages/app/features/watch/watch-payload.ts`.
struct WatchQRMatrix: Codable, Hashable {
    let size: Int
    let bits: String

    /// Row-major dark/light modules, or nil if `bits` is malformed or short — a
    /// half-drawn code would scan as the wrong ticket, so it must fail closed.
    var modules: [Bool]? {
        guard size > 0 else { return nil }
        let count = size * size
        var out = [Bool]()
        out.reserveCapacity(count)
        for ch in bits {
            guard let nibble = ch.hexDigitValue else { return nil }
            for shift in stride(from: 3, through: 0, by: -1) {
                guard out.count < count else { break }
                out.append((nibble >> shift) & 1 == 1)
            }
        }
        return out.count == count ? out : nil
    }
}

/// The compact ticket DTO the phone pushes over WCSession and persists into the
/// watch App Group. Mirrors `packages/app/src/watch/watch-payload.ts` — keep the
/// two in lockstep. `qrToken` is the EXACT string the host scanner expects
/// (64-char hex), rendered byte-identical to the phone (see docs/watch-app-fit.md).
struct WatchTicket: Identifiable, Codable, Hashable {
    let id: String
    let eventId: String
    let qrToken: String
    let status: TicketStatus

    /// Present only for a `valid` ticket — nothing else presents a scannable code,
    /// and the single WCSession application-context slot is precious.
    let qrMatrix: WatchQRMatrix?

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

    /// nil when the phone could not resolve identity; false means this pass is
    /// held under someone else's account and was bought for the wearer.
    let isOwner: Bool?

    enum CodingKeys: String, CodingKey {
        case id, eventId, qrToken, qrMatrix, status, tier, tierName, tableNumber
        case checkedInAt, eventTitle, eventDate, eventEndDate, eventLocation, entryWindow
        case isOwner
    }

    /// Lenient decode — the bridge maps the DB `scanned` to `checked_in`, but be
    /// defensive about either reaching us.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        eventId = try c.decode(String.self, forKey: .eventId)
        qrToken = (try? c.decode(String.self, forKey: .qrToken)) ?? ""
        qrMatrix = try? c.decode(WatchQRMatrix.self, forKey: .qrMatrix)
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
        isOwner = try? c.decode(Bool.self, forKey: .isOwner)
    }
}

/// The member's resolved capabilities, as projected by the phone. Mirrors
/// `WatchMembershipDTO` in `packages/app/features/watch/watch-payload.ts`.
///
/// The watch resolves nothing: no plan ranking, no date maths against a period
/// end, no processor SDK. It renders what the phone's resolver already decided,
/// which is what keeps invariant I3 true on this side of the wire too.
struct WatchMembership: Codable, Hashable {
    let planLabel: String
    let memberBadge: Bool
    let priorityRsvp: Bool
    let earlyTicketAccess: Bool
    let vipAdmission: Bool
    let expeditedEntry: Bool
    let coatCheck: Bool

    /// What this plan changes about walking up to a door tonight, in the order a
    /// member would use it. Anything that does not change behaviour at a venue
    /// (badges, RSVP priority, early access) is deliberately absent — it is
    /// phone-side marketing, and the wrist is not where it belongs.
    var doorPerks: [(symbol: String, label: String)] {
        var out: [(String, String)] = []
        if expeditedEntry { out.append(("figure.walk.motion", "EXPEDITED ENTRY")) }
        if vipAdmission { out.append(("star.fill", "VIP ADMISSION")) }
        if coatCheck { out.append(("hanger", "COAT CHECK INCLUDED")) }
        return out
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

    /// Absent until the phone's entitlement query resolves. Absent means "we do
    /// not know yet", which the UI renders as nothing — never as Free.
    let membership: WatchMembership?

    static let empty = WatchTicketEnvelope(tickets: [], syncedAt: 0, membership: nil)

    init(tickets: [WatchTicket], syncedAt: Double, membership: WatchMembership? = nil) {
        self.tickets = tickets
        self.syncedAt = syncedAt
        self.membership = membership
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tickets = (try? c.decode([WatchTicket].self, forKey: .tickets)) ?? []
        syncedAt = (try? c.decode(Double.self, forKey: .syncedAt)) ?? 0
        membership = try? c.decode(WatchMembership.self, forKey: .membership)
    }
}
