import Foundation
import Combine

/// Authorized aggregate cache. Failed refreshes preserve counts and their original timestamp.
@MainActor final class DoorStore: ObservableObject {
    static let appGroup = "group.com.dvnt.app.watch"
    static let storageKey = "dvnt.door.envelope"
    @Published private(set) var envelope: WatchDoorEnvelope = .empty
    private var defaults: UserDefaults?
    private var retired: Set<String> = []
    init(defaults: UserDefaults? = UserDefaults(suiteName: "group.com.dvnt.app.watch")) {
        self.defaults = defaults
        retired = Set(defaults?.stringArray(forKey: "dvnt.door.retired") ?? [])
        if let data = defaults?.data(forKey: Self.storageKey),
           let env = try? JSONDecoder().decode(WatchDoorEnvelope.self, from: data) { envelope = env }
    }
    var door: WatchDoor? { envelope.door }
    var isEmpty: Bool { envelope.door == nil }
    var error: String? { envelope.status == "error" ? envelope.error ?? "Couldn’t refresh door counts." : nil }
    var syncedAt: Date? { envelope.syncedAt > 0 ? Date(timeIntervalSince1970: envelope.syncedAt) : nil }
    var isStale: Bool { syncedAt.map { Date().timeIntervalSince($0) > 60 } ?? true }
    func resetAccount(_ generation: String) {
        guard !generation.isEmpty, !retired.contains(generation) else { return }
        if !envelope.accountGen.isEmpty && envelope.accountGen != generation {
            retired.insert(envelope.accountGen)
            defaults?.set(Array(retired), forKey: "dvnt.door.retired")
        }
        var empty = WatchDoorEnvelope.empty; empty.accountGen = generation
        envelope = empty; persist()
    }
    func apply(_ next: WatchDoorEnvelope) {
        guard next.protocol == 2, !next.accountGen.isEmpty, !retired.contains(next.accountGen),
              next.syncedAt.isFinite, next.syncedAt >= 0, ["ready", "error"].contains(next.status) else { return }
        if next.accountGen != envelope.accountGen {
            guard next.syncedAt >= envelope.syncedAt else { return }
            resetAccount(next.accountGen)
        }
        if next.status == "error" {
            var failed = envelope; failed.status = "error"; failed.error = next.error
            envelope = failed; persist(); return
        }
        guard next.syncedAt >= envelope.syncedAt else { return }
        envelope = next; persist()
    }
    func ingest(json data: Data) {
        guard let next = try? JSONDecoder().decode(WatchDoorEnvelope.self, from: data) else {
            var failed = envelope; failed.status = "error"; failed.error = "Door counts unavailable. Retry."
            envelope = failed; persist(); return
        }
        apply(next)
    }
    private func persist() {
        if let data = try? JSONEncoder().encode(envelope) { defaults?.set(data, forKey: Self.storageKey) }
    }
}
