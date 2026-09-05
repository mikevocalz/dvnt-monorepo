import Foundation

struct WatchEventWaitlist: Codable, Hashable {
    let ticketTypeId: String?
    let offerStatus: String
    let offerExpiresAt: String?
}

struct WatchEventWeather: Codable, Hashable {
    let tempF: Double; let label: String?; let generatedAt: String; let precipPct: Double?; var forecastAt: String? = nil
}

struct WatchEventMoment: Codable, Identifiable, Hashable {
    let id: String
    let imageURL: String
    let expiresAt: String
    let visibleUntil: String
    var cutoff: Date { min(WatchEvent.date(expiresAt) ?? .distantPast, WatchEvent.date(visibleUntil) ?? .distantPast) }
}

struct WatchEvent: Codable, Identifiable, Hashable {
    let id: String
    let title: String
    let startAt: String?
    let endAt: String?
    let timeZone: String?
    let imageURL: String?
    let location: String?
    let latitude: Double?
    let longitude: Double?
    let isOnline: Bool
    let status: String
    let ticketingEnabled: Bool
    let rsvp: String?
    let inviteStatus: String?
    let saved: Bool
    let host: Bool
    let waitlist: [WatchEventWaitlist]
    let canJoinWaitlist: Bool
    var weather: WatchEventWeather? = nil
    var moments: [WatchEventMoment]? = nil
    var momentsStatus: String? = nil

    var startsAt: Date? { Self.date(startAt) }
    var endsAt: Date? { Self.date(endAt) }
    static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }
    var stateLabel: String {
        if status == "cancelled" { return "Cancelled" }
        if status == "postponed" { return "Postponed" }
        if status != "active" { return "Status unavailable" }
        if inviteStatus == "pending" { return "Invitation" }
        if !waitlist.isEmpty { return "On waitlist" }
        if rsvp == "going" { return "Going" }
        if rsvp == "interested" { return "Interested" }
        if rsvp == "not_going" { return "Not going" }
        if host { return "Hosting" }
        return saved ? "Saved" : "Event"
    }
    func section(at now: Date = Date()) -> String {
        var calendar = Calendar.current
        if let timeZone, let zone = TimeZone(identifier: timeZone) { calendar.timeZone = zone }
        if let endsAt, endsAt <= now { return "Past" }
        if endsAt == nil, let startsAt, calendar.startOfDay(for: startsAt) < calendar.startOfDay(for: now) { return "Past" }
        if let startsAt, startsAt <= now, let endsAt, endsAt > now { return "Tonight" }
        if let startsAt, calendar.isDate(startsAt, inSameDayAs: now) { return "Tonight" }
        if inviteStatus == "pending" { return "Invitations" }
        if !waitlist.isEmpty { return "Waitlist" }
        if rsvp == "going" { return "Going" }
        if rsvp == "interested" { return "Interested" }
        if host { return "Hosting" }
        return "Saved"
    }
}

struct WatchEventEnvelope: Codable {
    let `protocol`: Int
    let accountGen: String
    let syncedAt: Double
    let events: [WatchEvent]
    let status: String
    let error: String?
    var hasMore: Bool? = nil
    var hasPrevious: Bool? = nil
    static let empty = WatchEventEnvelope(protocol: 2, accountGen: "", syncedAt: 0, events: [], status: "ready", error: nil)
}

struct WatchEventCommand: Codable {
    let `protocol`: Int
    let accountGen: String
    let operationId: String
    let type: String
    let eventId: String
    let action: String
    let ticketTypeId: String?
    let issuedAt: Double
    let expiresAt: Double
}

struct WatchEventResult: Codable {
    let `protocol`: Int
    let accountGen: String
    let operationId: String
    let eventId: String
    let status: String
    let message: String?
}
