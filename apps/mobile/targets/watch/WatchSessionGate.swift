import Foundation

struct WatchSessionEnvelope: Codable {
    let `protocol`: Int
    let accountGen: String
    let syncedAt: Double
}

/// Session ordering is independent of each domain's snapshot timestamp.
/// A reset journal survives termination between accepting a session and clearing stores.
final class WatchSessionGate {
    private struct State: Codable {
        var accountGen: String = ""
        var syncedAt: Double = 0
        var retired: Set<String> = []
        var pendingReset = false
    }
    private var state: State
    private let defaults: UserDefaults
    private let key = "dvnt.watch.session.v2"
    var accountGen: String { state.accountGen }
    var requiresReset: Bool { state.pendingReset }
    var hasV2: Bool { !accountGen.isEmpty }

    init(defaults: UserDefaults = UserDefaults(suiteName: "group.com.dvnt.app.watch") ?? .standard) {
        self.defaults = defaults
        state = defaults.data(forKey: key).flatMap { try? JSONDecoder().decode(State.self, from: $0) } ?? State()
    }

    func accept(_ session: WatchSessionEnvelope) -> Bool {
        guard session.protocol == 2, !session.accountGen.isEmpty,
              session.syncedAt.isFinite, session.syncedAt > 0,
              !state.retired.contains(session.accountGen) else { return false }
        if session.accountGen != state.accountGen {
            guard session.syncedAt >= state.syncedAt else { return false }
            if !state.accountGen.isEmpty { state.retired.insert(state.accountGen) }
            state.accountGen = session.accountGen
            state.pendingReset = true
        }
        state.syncedAt = max(state.syncedAt, session.syncedAt)
        persist()
        return true
    }

    func completeReset() { state.pendingReset = false; persist() }
    private func persist() {
        if let data = try? JSONEncoder().encode(state) { defaults.set(data, forKey: key) }
    }
}
