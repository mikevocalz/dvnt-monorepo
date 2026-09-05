import Foundation
import Observation

struct WatchVenueCommand: Codable {
    let `protocol`: Int
    let accountGen: String
    let operationId: String
    let type: String
    let eventId: String
    let action: String
    let ticketId: String?
    let state: String?
    let body: String?
    let audience: String?
    let issuedAt: Double
    let expiresAt: Double
}
struct WatchVenueResult: Codable {
    let `protocol`: Int
    let accountGen: String
    let operationId: String
    let eventId: String
    let status: String
    let message: String
    let state: String?
}
@MainActor @Observable final class VenueActionStore {
    private(set) var accountGen = ""
    var drafts: [String: String] = [:] { didSet { persist() } }
    private(set) var commands: [String: WatchVenueCommand] = [:]
    private(set) var results: [String: WatchVenueResult] = [:]
    private(set) var sending: Set<String> = []
    @ObservationIgnored var relay: ((WatchVenueCommand) -> Bool)?
    @ObservationIgnored var requestSync: (() -> Void)?
    @ObservationIgnored private var defaults: UserDefaults?
    private struct Saved: Codable {
        let accountGen: String
        let drafts: [String: String]
        let commands: [String: WatchVenueCommand]
        let results: [String: WatchVenueResult]
    }
    init(defaults: UserDefaults? = UserDefaults(suiteName: "group.com.dvnt.app.watch")) {
        self.defaults = defaults
        if let data = defaults?.data(forKey: "dvnt.venue.actions"), let saved = try? JSONDecoder().decode(Saved.self, from: data) {
            accountGen = saved.accountGen; commands = saved.commands; results = saved.results; drafts = saved.drafts
            for (id, command) in commands where results[id] == nil {
                results[id] = result(command, status: "uncertain", message: "Result not confirmed. Check your phone before sending again.")
            }
        }
    }
    func resetAccount(_ generation: String) {
        accountGen = generation; drafts = [:]; commands = [:]; results = [:]; sending = []; persist()
    }
    func newNotice(_ eventId: String) {
        guard !sending.contains(eventId) else { return }
        drafts[eventId] = nil; commands[eventId] = nil; results[eventId] = nil; persist()
    }
    func presence(eventId: String, ticketId: String, state: String) {
        guard ["approaching", "arrived", "departed", "revoke"].contains(state), !ticketId.isEmpty else { return }
        perform(eventId: eventId, action: "presence", ticketId: ticketId, state: state)
    }
    func notice(eventId: String, audience: String) {
        guard let body = drafts[eventId]?.trimmingCharacters(in: .whitespacesAndNewlines), !body.isEmpty,
              body.utf16.count <= 400, ["all", "scanned", "unscanned"].contains(audience),
              !(commands[eventId]?.action == "notice" && results[eventId]?.status == "uncertain") else { return }
        perform(eventId: eventId, action: "notice", body: body, audience: audience)
    }
    private func perform(eventId: String, action: String, ticketId: String? = nil, state: String? = nil, body: String? = nil, audience: String? = nil) {
        guard !accountGen.isEmpty, !sending.contains(eventId) else { return }
        let now = Date().timeIntervalSince1970
        let command = WatchVenueCommand(protocol: 2, accountGen: accountGen, operationId: UUID().uuidString,
            type: "venueAction", eventId: eventId, action: action, ticketId: ticketId, state: state,
            body: body, audience: audience, issuedAt: now, expiresAt: now + 60)
        commands[eventId] = command; results[eventId] = nil; sending.insert(eventId); persist()
        if relay?(command) != true {
            receive(result(command, status: "rejected", message: "iPhone unavailable. Connect and send again.")); return
        }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(22))
            guard let self, self.sending.contains(eventId), self.commands[eventId]?.operationId == command.operationId else { return }
            self.fail(command, message: "Result not confirmed. Check your phone before sending again.")
        }
    }
    func fail(_ command: WatchVenueCommand, message: String) { receive(result(command, status: "uncertain", message: message)) }
    private func result(_ command: WatchVenueCommand, status: String, message: String) -> WatchVenueResult {
        WatchVenueResult(protocol: 2, accountGen: command.accountGen, operationId: command.operationId,
            eventId: command.eventId, status: status, message: message, state: nil)
    }
    func receive(_ result: WatchVenueResult) {
        guard result.protocol == 2, result.accountGen == accountGen,
              commands[result.eventId]?.operationId == result.operationId,
              ["confirmed", "rejected", "uncertain"].contains(result.status) else { return }
        // A late transport timeout cannot replace a confirmed backend result.
        if results[result.eventId]?.status == "confirmed" { return }
        sending.remove(result.eventId); results[result.eventId] = result
        if result.status == "confirmed", commands[result.eventId]?.action == "notice" { drafts[result.eventId] = nil }
        persist()
        if result.status == "confirmed" { requestSync?() }
    }
    private func persist() {
        if let data = try? JSONEncoder().encode(Saved(accountGen: accountGen, drafts: drafts, commands: commands, results: results)) { defaults?.set(data, forKey: "dvnt.venue.actions") }
    }
}
