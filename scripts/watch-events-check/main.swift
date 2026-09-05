import Foundation
@main struct EventChecks {
    @MainActor static func main() throws {
        let suite = "dvnt.events.test.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let event = WatchEvent(id: "1", title: "Invitation without ticket", startAt: "2026-09-06T23:00:00Z", endAt: nil, timeZone: "America/New_York", imageURL: nil, location: nil, latitude: nil, longitude: nil, isOnline: false, status: "active", ticketingEnabled: false, rsvp: nil, inviteStatus: "pending", saved: false, host: false, waitlist: [], canJoinWaitlist: false)
        let now = WatchEvent.date("2026-09-05T12:00:00Z")!
        precondition(event.section(at: now) == "Invitations")
        let store = EventStore(defaults: defaults)
        store.resetAccount("A")
        store.apply(WatchEventEnvelope(protocol: 2, accountGen: "A", syncedAt: 100, events: [event], status: "ready", error: nil))
        precondition(store.events.count == 1)
        store.apply(WatchEventEnvelope(protocol: 2, accountGen: "A", syncedAt: 110, events: [], status: "error", error: "Offline"))
        precondition(store.events.count == 1 && store.error == "Offline")
        store.perform(eventId: "1", action: "interested")
        precondition(store.pending.isEmpty && store.results["1"]?.status == "failed")
        store.resetAccount("B")
        precondition(store.events.isEmpty && store.results.isEmpty && store.error == nil && store.envelope.syncedAt == 0)
        let restarted = EventStore(defaults: defaults)
        restarted.apply(WatchEventEnvelope(protocol: 2, accountGen: "A", syncedAt: 1000, events: [event], status: "ready", error: nil))
        precondition(restarted.envelope.accountGen == "B" && restarted.events.isEmpty)
        restarted.apply(WatchEventEnvelope(protocol: 2, accountGen: "B", syncedAt: 90, events: [event], status: "ready", error: nil))
        precondition(restarted.events.count == 1)
        restarted.apply(WatchEventEnvelope(protocol: 2, accountGen: "B", syncedAt: 80, events: [], status: "ready", error: nil))
        precondition(restarted.events.count == 1)
        print("PASS independent invitation, cached error, truthful offline command, account reset/restart/replay, snapshot ordering")
    }
}
