import Foundation
@main struct DoorStoreTests {
    @MainActor static func main() {
        let name = "dvnt.door.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let store = DoorStore(defaults: defaults)
        let json = #"{"protocol":2,"accountGen":"A","status":"ready","syncedAt":100,"door":{"eventId":"1","eventTitle":"Fixture","expected":10,"arrived":4,"remaining":6,"priorityLane":2,"approaching":3}}"#
        store.ingest(json: Data(json.utf8))
        precondition(store.door?.arrived == 4 && store.envelope.syncedAt == 100)
        store.ingest(json: Data(#"{"protocol":2,"accountGen":"A","status":"error","syncedAt":0,"door":null,"error":"Network unavailable"}"#.utf8))
        precondition(store.door?.arrived == 4 && store.envelope.syncedAt == 100 && store.error == "Network unavailable")
        store.ingest(json: Data(json.replacingOccurrences(of: ":100", with: ":99").utf8))
        precondition(store.error == "Network unavailable")
        store.ingest(json: Data(json.utf8))
        precondition(store.error == nil)
        store.ingest(json: Data(json.replacingOccurrences(of: "\"arrived\":4,", with: "").utf8))
        precondition(store.door?.arrived == 4 && store.error != nil)
        store.resetAccount("B")
        precondition(store.door == nil && store.envelope.syncedAt == 0)
        store.ingest(json: Data(json.replacingOccurrences(of: ":100", with: ":1000").utf8))
        precondition(store.envelope.accountGen == "B" && store.door == nil)
        let restored = DoorStore(defaults: defaults)
        restored.ingest(json: Data(json.replacingOccurrences(of: ":100", with: ":1001").utf8))
        precondition(restored.envelope.accountGen == "B" && restored.door == nil)
        print("PASS door error preservation, invalid count rejection, monotonic ready snapshot, account and cold retired-generation guards")
    }
}
