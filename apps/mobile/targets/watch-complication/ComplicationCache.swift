import Foundation

struct ComplicationSnapshot {
    let title: String
    let eventDate: Date?
    let syncedAt: Double
    let url: URL?
    func isStale(at date: Date) -> Bool { syncedAt <= 0 || date.timeIntervalSince1970 - syncedAt > 3600 }
    static let empty = ComplicationSnapshot(title: "DVNT", eventDate: nil, syncedAt: 0, url: nil)
}

enum ComplicationCache {
    static let appGroup = "group.com.dvnt.app.watch"
    static func snapshot(defaults: UserDefaults? = UserDefaults(suiteName: appGroup), now: Date = Date()) -> ComplicationSnapshot {
        guard let defaults, let sessionData = defaults.data(forKey: "dvnt.watch.session.v2"),
              let session = try? JSONSerialization.jsonObject(with: sessionData) as? [String: Any],
              session["pendingReset"] as? Bool != true,
              let generation = session["accountGen"] as? String, !generation.isEmpty,
              let data = defaults.data(forKey: "dvnt.tickets.envelope"),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = json["tickets"] as? [[String: Any]] else { return .empty }
        let tickets = rows.filter { row in
            guard row["status"] as? String == "valid" else { return false }
            if let end = (row["eventEndDate"] as? String).flatMap(parse), end <= now { return false }
            if let start = (row["eventDate"] as? String).flatMap(parse), row["eventEndDate"] == nil,
               start.addingTimeInterval(8 * 3600) <= now { return false }
            return true
        }.sorted { lhs, rhs in
            ((lhs["eventDate"] as? String).flatMap(parse) ?? .distantFuture) <
                ((rhs["eventDate"] as? String).flatMap(parse) ?? .distantFuture)
        }
        if let row = tickets.first, let id = row["id"] as? String {
            return ComplicationSnapshot(title: row["eventTitle"] as? String ?? "DVNT",
                eventDate: (row["eventDate"] as? String).flatMap(parse),
                syncedAt: json["syncedAt"] as? Double ?? 0,
                url: link(kind: "ticket", id: id, generation: generation))
        }
        guard let eventData = defaults.data(forKey: "dvnt.events.envelope"),
              let envelope = try? JSONSerialization.jsonObject(with: eventData) as? [String: Any],
              envelope["accountGen"] as? String == generation,
              let events = envelope["events"] as? [[String: Any]],
              let event = events.filter({ ($0["status"] as? String) == "active" })
                .filter({ (($0["startsAt"] as? String).flatMap(parse) ?? .distantPast) > now })
                .sorted(by: { ($0["startsAt"] as? String ?? "") < ($1["startsAt"] as? String ?? "") }).first,
              let id = event["id"] as? String else { return .empty }
        return ComplicationSnapshot(title: event["title"] as? String ?? "DVNT",
            eventDate: (event["startsAt"] as? String).flatMap(parse), syncedAt: envelope["syncedAt"] as? Double ?? 0,
            url: link(kind: "event", id: id, generation: generation))
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
