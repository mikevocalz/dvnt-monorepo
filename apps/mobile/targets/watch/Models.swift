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
        guard (21...177).contains(size), (size - 21) % 4 == 0 else { return nil }
        let count = size * size
        guard bits.utf8.count == (count + 3) / 4, bits.utf8.allSatisfy({ (48...57).contains($0) || (65...70).contains($0) || (97...102).contains($0) }) else { return nil }
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

    /// The flyer's colour, `#rrggbb`. Seven bytes, and the ONLY artwork that is
    /// guaranteed to be here with the phone in another room — which is why it,
    /// not `imageURL`, is what stops a card rendering as three lines of text on
    /// black.
    ///
    /// `AsyncImage` cannot satisfy offline-first: a paired-only watch has no
    /// network path, and AsyncImage writes nothing into the App Group this
    /// target persists into, so nothing it fetched survives the next launch.
    /// Nor can the pixels ride the wire — the single WCSession
    /// applicationContext slot is size-capped and precious (see `qrMatrix`
    /// above; it is shared with broadcasts, DMs and door counts). A hex always
    /// fits. The hex is the guarantee; the art is the upgrade.
    let dominantHex: String?

    /// A WATCH-SIZED rendition (~200x200 @2x) of the flyer — progressive
    /// enhancement drawn over `dominantHex` when the wrist happens to be able
    /// to reach the CDN. NEVER the full flyer, and never load-bearing: if it
    /// never resolves the card is already finished. See `EventArt`.
    let imageURL: String?

    /// nil when the phone could not resolve identity; false means this pass is
    /// held under someone else's account and was bought for the wearer.
    let isOwner: Bool?

    enum CodingKeys: String, CodingKey {
        case id, eventId, qrToken, qrMatrix, status, tier, tierName, tableNumber
        case checkedInAt, eventTitle, eventDate, eventEndDate, eventLocation, entryWindow
        case dominantHex, imageURL
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
        let raw = (try? c.decode(String.self, forKey: .status)) ?? "unknown"
        status = TicketStatus(rawValue: raw) ?? .unknown
        tier = try? c.decode(String.self, forKey: .tier)
        tierName = try? c.decode(String.self, forKey: .tierName)
        tableNumber = try? c.decode(String.self, forKey: .tableNumber)
        checkedInAt = try? c.decode(String.self, forKey: .checkedInAt)
        eventTitle = (try? c.decode(String.self, forKey: .eventTitle)) ?? "Event"
        eventDate = try? c.decode(String.self, forKey: .eventDate)
        eventEndDate = try? c.decode(String.self, forKey: .eventEndDate)
        eventLocation = try? c.decode(String.self, forKey: .eventLocation)
        entryWindow = try? c.decode(String.self, forKey: .entryWindow)
        // Both artwork fields decode leniently and independently: art is never
        // a reason to drop a ticket, and either one arriving alone is useful.
        dominantHex = try? c.decode(String.self, forKey: .dominantHex)
        imageURL = try? c.decode(String.self, forKey: .imageURL)
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
    case cancelled
    case unknown

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
        case .cancelled: return "Cancelled"
        case .unknown: return "Status unavailable"
        }
    }
}

/// A run of tickets for one event — the unit of the home list.
struct EventGroup: Identifiable {
    let id: String           // eventId
    let title: String
    let date: Date?
    let location: String?

    /// Event artwork, lifted off the tickets so a row can draw itself without
    /// reaching into `tickets`. Both are per-event, so any ticket in the group
    /// carries the same values — see `TicketStore.groups`.
    let dominantHex: String?
    let imageURL: String?

    let tickets: [WatchTicket]

    var count: Int { tickets.count }
    var hasPresentable: Bool { tickets.contains { $0.status.isPresentable } }
}

/// Whether a snapshot belongs to the session generation the watch is scoped to.
///
/// Tickets and broadcasts were the two domains applied without this check while
/// `events`, `threadPage`, `callDirectory`, `activeCall` and `call` all compared
/// the generation, so a protocol-2 snapshot built for a previous account could
/// repopulate the wrist. Wear enforces the same rule in `TicketRepository` and
/// `BroadcastRepository`; this is the one Swift copy both envelopes call.
enum WatchSessionScope {
    static func accepts(protocol protocolVersion: Int?, accountGen: String?, generation: String?) -> Bool {
        // A phone that predates protocol 2 sends no generation to check. Rejecting
        // it would blank a working watch on an older released build.
        guard protocolVersion == 2 else { return true }
        guard let generation, !generation.isEmpty else { return false }
        return accountGen == generation
    }
}

/// The whole payload the phone sends, with a sync timestamp for honest staleness.
struct WatchTicketEnvelope: Codable {
    let tickets: [WatchTicket]
    let syncedAt: Double      // epoch seconds (sent by the phone — watch clock-safe)

    /// Absent until the phone's entitlement query resolves. Absent means "we do
    /// not know yet", which the UI renders as nothing — never as Free.
    let membership: WatchMembership?

    /// Session scope, in lockstep with `WatchTicketEnvelope` in
    /// `packages/app/features/watch/watch-payload.ts` and the Kotlin envelope in
    /// `wear/.../Models.kt`. Both are optional because a released phone that
    /// predates protocol 2 sends neither, and a lenient decode must still show
    /// that phone's tickets.
    let `protocol`: Int?
    let accountGen: String?

    static let empty = WatchTicketEnvelope(tickets: [], syncedAt: 0, membership: nil)

    init(
        tickets: [WatchTicket],
        syncedAt: Double,
        membership: WatchMembership? = nil,
        protocol protocolVersion: Int? = nil,
        accountGen: String? = nil
    ) {
        self.tickets = tickets
        self.syncedAt = syncedAt
        self.membership = membership
        self.protocol = protocolVersion
        self.accountGen = accountGen
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        tickets = (try? c.decode([WatchTicket].self, forKey: .tickets)) ?? []
        syncedAt = (try? c.decode(Double.self, forKey: .syncedAt)) ?? 0
        membership = try? c.decode(WatchMembership.self, forKey: .membership)
        self.protocol = try? c.decode(Int.self, forKey: .protocol)
        accountGen = try? c.decode(String.self, forKey: .accountGen)
    }

    /// Mirrors `TicketRepository.ingest` on Wear.
    func belongs(toGeneration generation: String?) -> Bool {
        WatchSessionScope.accepts(protocol: self.protocol, accountGen: accountGen, generation: generation)
    }
}
