import Foundation

struct ComplicationSnapshot {
    let title: String
    let eventDate: Date?
    let syncedAt: Double
    let url: URL?
    var eventEnd: Date? = nil
    var latitude: Double? = nil
    var longitude: Double? = nil
    var unreadCount: Int = 0
    var doorArrived: Int? = nil
    func isStale(at date: Date) -> Bool { syncedAt <= 0 || date.timeIntervalSince1970 - syncedAt > 3600 }
    static let empty = ComplicationSnapshot(title: "DVNT", eventDate: nil, syncedAt: 0, url: nil)
}

enum ComplicationCache {
    static let appGroup = "group.com.dvnt.app.watch"
    static func snapshot(defaults: UserDefaults? = UserDefaults(suiteName: appGroup), now: Date = Date()) -> ComplicationSnapshot {
        guard let defaults, let session = dictionary(defaults, "dvnt.watch.session.v2"),
              session["pendingReset"] as? Bool != true,
              let generation = session["accountGen"] as? String, !generation.isEmpty else { return .empty }
        let dm = dictionary(defaults, "dvnt.dms.envelope")
        let unread = dm?["accountGen"] as? String == generation ? (dm?["dms"] as? [[String: Any]] ?? []).filter { $0["unread"] as? Bool == true }.count : 0
        let door = dictionary(defaults, "dvnt.door.envelope")
        let doorAge = now.timeIntervalSince1970 - (door?["syncedAt"] as? Double ?? 0)
        let arrived = door?["accountGen"] as? String == generation && doorAge >= -5 && doorAge <= 120 && door?["status"] as? String == "ready"
            ? (door?["door"] as? [String: Any])?["arrived"] as? Int : nil
        let eventEnvelope = dictionary(defaults, "dvnt.events.envelope")
        let events = eventEnvelope?["accountGen"] as? String == generation ? eventEnvelope?["events"] as? [[String: Any]] ?? [] : []
        let ticketEnvelope = dictionary(defaults, "dvnt.tickets.envelope")
        let tickets = (ticketEnvelope?["tickets"] as? [[String: Any]] ?? []).filter { row in
            guard row["status"] as? String == "valid" else { return false }
            guard let start = (row["eventDate"] as? String).flatMap(parse) else { return false }
            return ((row["eventEndDate"] as? String).flatMap(parse) ?? start.addingTimeInterval(8 * 3600)) > now
        }.sorted { ($0["eventDate"] as? String ?? "") < ($1["eventDate"] as? String ?? "") }
        func enrich(_ snapshot: ComplicationSnapshot, event: [String: Any]?) -> ComplicationSnapshot {
            var result = snapshot
            result.unreadCount = unread; result.doorArrived = arrived
            result.eventEnd = (event?["endAt"] as? String).flatMap(parse)
            if let lat = event?["latitude"] as? Double, let lng = event?["longitude"] as? Double,
               lat.isFinite, lng.isFinite, abs(lat) <= 90, abs(lng) <= 180 {
                result.latitude = lat; result.longitude = lng
            }
            return result
        }
        if let row = tickets.first, let id = row["id"] as? String {
            let event = events.first { $0["id"] as? String == row["eventId"] as? String }
            return enrich(ComplicationSnapshot(title: row["eventTitle"] as? String ?? "DVNT",
                eventDate: (row["eventDate"] as? String).flatMap(parse), syncedAt: ticketEnvelope?["syncedAt"] as? Double ?? 0,
                url: link(kind: "ticket", id: id, generation: generation)), event: event)
        }
        if let event = events.filter({ row in
            guard row["status"] as? String == "active", let start = (row["startAt"] as? String).flatMap(parse) else { return false }
            return ((row["endAt"] as? String).flatMap(parse) ?? start.addingTimeInterval(8 * 3600)) > now
        }).sorted(by: { ($0["startAt"] as? String ?? "") < ($1["startAt"] as? String ?? "") }).first,
           let id = event["id"] as? String {
            return enrich(ComplicationSnapshot(title: event["title"] as? String ?? "DVNT",
                eventDate: (event["startAt"] as? String).flatMap(parse), syncedAt: eventEnvelope?["syncedAt"] as? Double ?? 0,
                url: link(kind: "event", id: id, generation: generation)), event: event)
        }
        var empty = ComplicationSnapshot.empty
        empty.unreadCount = unread; empty.doorArrived = arrived
        return empty
    }
    private static func dictionary(_ defaults: UserDefaults, _ key: String) -> [String: Any]? {
        defaults.data(forKey: key).flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] }
    }
    static func link(kind: String, id: String, generation: String) -> URL? {
        var components = URLComponents()
        components.scheme = "dvnt-watch"; components.host = kind
        components.queryItems = [URLQueryItem(name: "id", value: id), URLQueryItem(name: "accountGen", value: generation)]
        return components.url
    }
    static func parse(_ iso: String) -> Date? {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let value = formatter.date(from: iso) { return value }
        formatter.formatOptions = [.withInternetDateTime]
        return formatter.date(from: iso)
    }
}
