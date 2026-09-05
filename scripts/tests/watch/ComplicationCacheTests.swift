import Foundation
@main struct ComplicationCacheTests {
    static func main() throws {
        let name = "dvnt.complication.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        func put(_ key: String, _ object: [String: Any]) throws { defaults.set(try JSONSerialization.data(withJSONObject: object), forKey: key) }
        let now = Date(timeIntervalSince1970: 1_800_000_000)
        try put("dvnt.watch.session.v2", ["accountGen": "a", "pendingReset": false])
        try put("dvnt.events.envelope", ["accountGen": "a", "syncedAt": now.timeIntervalSince1970, "events": [["id": "3", "title": "No ticket event", "status": "active", "startAt": ISO8601DateFormatter().string(from: now.addingTimeInterval(3600))]]])
        let event = ComplicationCache.snapshot(defaults: defaults, now: now)
        precondition(event.title == "No ticket event" && event.url?.host == "event", "Event fallback must work with no ticket cache and startAt wire key")
        try put("dvnt.dms.envelope", ["accountGen": "a", "dms": [["unread": true], ["unread": false]]])
        try put("dvnt.door.envelope", ["accountGen": "a", "status": "ready", "syncedAt": now.timeIntervalSince1970 - 121, "door": ["arrived": 12]])
        let counts = ComplicationCache.snapshot(defaults: defaults, now: now)
        precondition(counts.unreadCount == 1 && counts.doorArrived == nil, "Stale door counts must expire")
        try put("dvnt.dms.envelope", ["accountGen": "old", "dms": [["unread": true]]])
        precondition(ComplicationCache.snapshot(defaults: defaults, now: now).unreadCount == 0)
        try put("dvnt.watch.session.v2", ["accountGen": "a", "pendingReset": true])
        precondition(ComplicationCache.snapshot(defaults: defaults, now: now).url == nil)
        print("ComplicationCacheTests passed")
    }
}
