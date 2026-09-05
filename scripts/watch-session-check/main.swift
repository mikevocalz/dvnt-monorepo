import Foundation
@main struct SessionChecks {
    static func main() {
        let suite = "dvnt.session.test.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let gate = WatchSessionGate(defaults: defaults)
        func session(_ gen: String, _ stamp: Double) -> WatchSessionEnvelope {
            WatchSessionEnvelope(protocol: 2, accountGen: gen, syncedAt: stamp)
        }
        precondition(gate.accept(session("A", 100)))
        precondition(gate.requiresReset)
        gate.completeReset()
        precondition(gate.accept(session("A", 90))) // Independent domain delivery.
        precondition(!gate.requiresReset)
        precondition(!gate.accept(session("older", 99)))
        precondition(gate.accept(session("B", 100))) // Same-second account transition.
        let restarted = WatchSessionGate(defaults: defaults)
        precondition(restarted.requiresReset) // Interrupted clear must finish on cold launch.
        restarted.completeReset()
        precondition(!restarted.accept(session("A", 1000)))
        precondition(restarted.accountGen == "B")
        precondition(!restarted.accept(session("", 1001)))
        precondition(!restarted.accept(WatchSessionEnvelope(protocol: 1, accountGen: "C", syncedAt: 1001)))
        precondition(!restarted.accept(session("C", .infinity)))
        precondition(WatchSessionGate(defaults: defaults).accountGen == "B")
        print("PASS session ordering, retired generation replay, cold reset journal, invalid protocol")
    }
}
