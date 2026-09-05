import Foundation
@main struct VenueActionTests {
    @MainActor static func main() {
        let name = "dvnt.venue.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let store = VenueActionStore(defaults: defaults)
        store.resetAccount("A")
        var requests: [WatchVenueCommand] = []
        store.relay = { requests.append($0); return true }
        store.drafts["1"] = "Doors open"
        store.notice(eventId: "1", audience: "all")
        precondition(requests.count == 1 && store.sending.contains("1"))
        store.notice(eventId: "1", audience: "all")
        precondition(requests.count == 1)
        let restarted = VenueActionStore(defaults: defaults)
        precondition(restarted.results["1"]?.status == "uncertain" && restarted.drafts["1"] == "Doors open")
        restarted.relay = { requests.append($0); return true }
        restarted.notice(eventId: "1", audience: "all")
        precondition(requests.count == 1)
        let command = requests[0]
        let result = WatchVenueResult(protocol: 2, accountGen: "A", operationId: command.operationId, eventId: "1", status: "confirmed", message: "Notice sent", state: nil)
        store.receive(result)
        precondition(store.drafts["1"] == nil && store.results["1"]?.status == "confirmed")
        store.fail(command, message: "late failure")
        precondition(store.results["1"]?.status == "confirmed")
        store.presence(eventId: "1", ticketId: "self", state: "late")
        precondition(requests.count == 1)
        store.presence(eventId: "1", ticketId: "self", state: "arrived")
        precondition(requests.count == 2 && requests.last?.state == "arrived")
        store.resetAccount("B")
        store.receive(result)
        precondition(store.results.isEmpty && store.commands.isEmpty && store.drafts.isEmpty)
        print("PASS venue store explicit send, cold pending lock, backend confirmation, late response, supported state, account clear")
    }
}
