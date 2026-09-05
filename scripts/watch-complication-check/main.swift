import Foundation
@main struct ComplicationChecks {
    static func main() throws {
        let suite = "dvnt.complication.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let now = Date(timeIntervalSince1970: 100000)
        func put(_ key: String, _ value: [String: Any]) throws {
            defaults.set(try JSONSerialization.data(withJSONObject: value), forKey: key)
        }
        precondition(ComplicationCache.snapshot(defaults: defaults, now: now).url == nil)
        try put("dvnt.watch.session.v2", ["accountGen": "member A", "pendingReset": false])
        try put("dvnt.tickets.envelope", ["syncedAt": 99000, "tickets": [
            ["id": "pass &/one", "status": "valid", "eventTitle": "Test event", "eventDate": "1970-01-03T00:00:00Z"],
            ["id": "used", "status": "used", "eventTitle": "Used event"]]])
        let snapshot = ComplicationCache.snapshot(defaults: defaults, now: now)
        let link = WatchDeepLink(url: snapshot.url!)!
        precondition(link.kind == "ticket" && link.target == "pass &/one" && link.accountGen == "member A")
        precondition(!snapshot.isStale(at: now) && snapshot.isStale(at: now.addingTimeInterval(4000)))
        try put("dvnt.watch.session.v2", ["accountGen": "member B", "pendingReset": true])
        precondition(ComplicationCache.snapshot(defaults: defaults, now: now).url == nil)
        try put("dvnt.watch.session.v2", ["accountGen": "member B", "pendingReset": false])
        try put("dvnt.tickets.envelope", ["syncedAt": 0, "tickets": []])
        try put("dvnt.events.envelope", ["accountGen": "member B", "syncedAt": 99900, "events": [
            ["id": "event-2", "status": "active", "title": "Upcoming", "startsAt": "1970-01-03T00:00:00Z"]]])
        let event = ComplicationCache.snapshot(defaults: defaults, now: now)
        precondition(WatchDeepLink(url: event.url!)?.kind == "event")
        precondition(WatchDeepLink(url: URL(string: "dvnt-watch://ticket?id=1")!) == nil)
        precondition(WatchDeepLink(url: URL(string: "https://ticket?id=1&accountGen=A")!) == nil)
        print("PASS complication cache, exact encoded route, session reset privacy, stale timestamp, event fallback")
    }
}
