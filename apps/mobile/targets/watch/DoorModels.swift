import Foundation

/// Mirror of `WatchDoorDTO` in
/// `packages/app/features/watch/watch-door-payload.ts` — keep the two in
/// lockstep, same PR.
///
/// Host mode. Four numbers a host can act on without taking a phone out of a
/// pocket at a door. Everything here is an AGGREGATE — there is no per-guest
/// field and no location field, because the presence feature that feeds
/// `approaching` only ever transmits state words.
struct WatchDoor: Codable, Hashable {
    let eventId: String
    let eventTitle: String
    let expected: Int
    /// Scanned in. The door's own number — presence never contributes to it.
    let arrived: Int
    let remaining: Int
    let priorityLane: Int
    let approaching: Int

    enum CodingKeys: String, CodingKey {
        case eventId, eventTitle, expected, arrived, remaining, priorityLane, approaching
    }

    /// An absent or invalid count is unknown, never an invented zero.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        eventId = try c.decode(String.self, forKey: .eventId)
        eventTitle = try c.decode(String.self, forKey: .eventTitle)
        expected = try c.decode(Int.self, forKey: .expected)
        arrived = try c.decode(Int.self, forKey: .arrived)
        remaining = try c.decode(Int.self, forKey: .remaining)
        priorityLane = try c.decode(Int.self, forKey: .priorityLane)
        approaching = try c.decode(Int.self, forKey: .approaching)
        guard !eventId.isEmpty, [expected, arrived, remaining, priorityLane, approaching].allSatisfy({ $0 >= 0 }) else {
            throw DecodingError.dataCorruptedError(forKey: .eventId, in: c, debugDescription: "Invalid door counts")
        }
    }
}

struct WatchDoorEnvelope: Codable {
    let door: WatchDoor?
    let syncedAt: Double
    var `protocol`: Int = 2
    var accountGen: String = ""
    var status: String = "ready"
    var error: String?
    static let empty = WatchDoorEnvelope(door: nil, syncedAt: 0)
}
