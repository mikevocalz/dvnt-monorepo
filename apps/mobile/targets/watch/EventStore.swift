import Foundation
import Observation

/// The phone's authorized event set is independent of the ticket cache.
/// Commands require a live phone and display success only after a server result.
@MainActor @Observable
final class EventStore {
    private(set) var envelope: WatchEventEnvelope = .empty
    private(set) var pending: [String: String] = [:]
    private(set) var results: [String: WatchEventResult] = [:]
    private(set) var error: String?
    @ObservationIgnored var relay: ((WatchEventCommand) -> Bool)?
    @ObservationIgnored var requestSync: (() -> Void)?
    @ObservationIgnored private var defaults: UserDefaults?
    @ObservationIgnored private var retired: Set<String>

    init(defaults: UserDefaults? = UserDefaults(suiteName: "group.com.dvnt.app.watch")) {
        self.defaults = defaults
        retired = Set(defaults?.stringArray(forKey: "dvnt.events.retired") ?? [])
        if let data = defaults?.data(forKey: "dvnt.events.envelope"),
           let value = try? JSONDecoder().decode(WatchEventEnvelope.self, from: data) { envelope = value }
    }
    var events: [WatchEvent] { envelope.events }
    var syncedAt: Date? { envelope.syncedAt > 0 ? Date(timeIntervalSince1970: envelope.syncedAt) : nil }
    let sections = ["Tonight", "Invitations", "Going", "Interested", "Waitlist", "Saved", "Hosting", "Past"]
    func events(in section: String) -> [WatchEvent] { events.filter { $0.section() == section } }

    func resetAccount(_ accountGen: String) {
        guard !accountGen.isEmpty, accountGen != envelope.accountGen, !retired.contains(accountGen) else { return }
        if !envelope.accountGen.isEmpty { retired.insert(envelope.accountGen) }
        defaults?.set(Array(retired), forKey: "dvnt.events.retired")
        pending = [:]; results = [:]; error = nil
        envelope = WatchEventEnvelope(protocol: 2, accountGen: accountGen, syncedAt: 0, events: [], status: "ready", error: nil)
        if let data = try? JSONEncoder().encode(envelope) { defaults?.set(data, forKey: "dvnt.events.envelope") }
    }

    func ingest(json: Data) {
        guard let next = try? JSONDecoder().decode(WatchEventEnvelope.self, from: json) else { return }
        apply(next)
    }
    func apply(_ next: WatchEventEnvelope) {
        guard next.protocol == 2, next.syncedAt.isFinite, next.syncedAt >= 0,
              ["ready", "error"].contains(next.status), !next.accountGen.isEmpty, !retired.contains(next.accountGen),
              next.syncedAt >= envelope.syncedAt else { return }
        if next.accountGen != envelope.accountGen {
            if !envelope.accountGen.isEmpty { retired.insert(envelope.accountGen) }
            defaults?.set(Array(retired), forKey: "dvnt.events.retired")
            pending = [:]; results = [:]
            envelope = .empty
            defaults?.removeObject(forKey: "dvnt.events.envelope")
        }
        if next.status == "error" { error = next.error; return }
        error = nil
        envelope = next
        if let data = try? JSONEncoder().encode(next) { defaults?.set(data, forKey: "dvnt.events.envelope") }
    }
    func perform(eventId: String, action: String, ticketTypeId: String? = nil) {
        guard pending[eventId] == nil, events.contains(where: { $0.id == eventId }) else { return }
        let now = Date().timeIntervalSince1970
        let command = WatchEventCommand(protocol: 2, accountGen: envelope.accountGen,
            operationId: UUID().uuidString, type: "eventAction", eventId: eventId, action: action,
            ticketTypeId: ticketTypeId, issuedAt: now, expiresAt: now + 30)
        pending[eventId] = command.operationId
        results[eventId] = nil
        if relay?(command) != true {
            fail(command, message: "Phone unavailable. Open DVNT on your phone and retry.")
            return
        }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(32))
            guard let self, self.pending[eventId] == command.operationId else { return }
            self.fail(command, message: "Result not confirmed. Check the event on your phone.")
        }
    }
    func fail(_ command: WatchEventCommand, message: String) {
        receive(WatchEventResult(protocol: 2, accountGen: command.accountGen, operationId: command.operationId,
            eventId: command.eventId, status: "failed", message: message))
    }
    func receive(_ result: WatchEventResult) {
        guard result.protocol == 2, result.accountGen == envelope.accountGen,
              pending[result.eventId] == result.operationId else { return }
        pending[result.eventId] = nil
        results[result.eventId] = result
        if result.status == "confirmed" { requestSync?() }
    }
}
