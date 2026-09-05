import Foundation
import Observation
@MainActor @Observable final class CallDirectoryStore {
    private(set) var envelope: WatchCallDirectory = .empty
    private(set) var searchResults: [WatchCallPerson] = []
    private(set) var pending: String?
    private(set) var message: String?
    private(set) var error: String?
    private(set) var searchFinished = false
    @ObservationIgnored var relay: ((WatchCallDirectoryCommand) -> Bool)?
    @ObservationIgnored var requestSync: (() -> Void)?
    @ObservationIgnored private var defaults: UserDefaults?
    @ObservationIgnored private var retired: Set<String>
    @ObservationIgnored private var pendingAction: String?
    init(defaults: UserDefaults? = UserDefaults(suiteName: "group.com.dvnt.app.watch")) {
        self.defaults = defaults
        retired = Set(defaults?.stringArray(forKey: "dvnt.callDirectory.retired") ?? [])
        if let data = defaults?.data(forKey: "dvnt.callDirectory.envelope"), let cached = try? JSONDecoder().decode(WatchCallDirectory.self, from: data) { envelope = cached }
    }
    func resetAccount(_ generation: String) {
        guard !generation.isEmpty, generation != envelope.accountGen, !retired.contains(generation) else { return }
        if !envelope.accountGen.isEmpty { retired.insert(envelope.accountGen) }
        defaults?.set(Array(retired), forKey: "dvnt.callDirectory.retired")
        envelope = WatchCallDirectory(protocol: 2, accountGen: generation, syncedAt: 0, people: [], recents: [], error: nil)
        pending = nil; pendingAction = nil; searchResults = []; searchFinished = false; message = nil; error = nil
        persist()
    }
    private func persist() { if let data = try? JSONEncoder().encode(envelope) { defaults?.set(data, forKey: "dvnt.callDirectory.envelope") } }
    func ingest(json: Data) { if let next = try? JSONDecoder().decode(WatchCallDirectory.self, from: json) { apply(next) } }
    func apply(_ next: WatchCallDirectory) {
        guard next.protocol == 2, next.syncedAt.isFinite, next.syncedAt >= envelope.syncedAt, !next.accountGen.isEmpty, !retired.contains(next.accountGen) else { return }
        if next.accountGen != envelope.accountGen { resetAccount(next.accountGen) }
        if let error = next.error { self.error = error; return }
        envelope = next; error = nil; persist()
    }
    func search(_ query: String) { send(action: "search", query: query, ids: nil, callType: nil) }
    func start(_ ids: [String], video: Bool) {
        guard (1...3).contains(ids.count), Set(ids).count == ids.count else { message = "Choose one to three people."; return }
        send(action: "start_on_phone", query: nil, ids: ids, callType: video ? "video" : "audio")
    }
    private func send(action: String, query: String?, ids: [String]?, callType: String?) {
        guard pending == nil else { return }
        let now = Date().timeIntervalSince1970
        let command = WatchCallDirectoryCommand(protocol: 2, accountGen: envelope.accountGen, operationId: UUID().uuidString, type: "callDirectoryAction", action: action, query: query, participantIds: ids, callType: callType, issuedAt: now, expiresAt: now + 30)
        pending = command.operationId; pendingAction = action; message = nil
        if action == "search" { searchFinished = false; searchResults = [] }
        guard relay?(command) == true else { fail(command, message: "Open DVNT on your phone and retry."); return }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(32))
            guard let self, self.pending == command.operationId else { return }
            self.fail(command, message: "Result not confirmed. Check your phone.")
        }
    }
    func fail(_ command: WatchCallDirectoryCommand, message: String) { receive(WatchCallDirectoryResult(protocol: 2, accountGen: command.accountGen, operationId: command.operationId, status: "failed", people: nil, message: message)) }
    func receive(_ result: WatchCallDirectoryResult) {
        guard result.protocol == 2, result.accountGen == envelope.accountGen, result.operationId == pending else { return }
        if pendingAction == "search" { searchFinished = result.status == "confirmed"; searchResults = result.people ?? [] }
        message = result.message; pending = nil; pendingAction = nil
    }
}
