import Foundation
import Combine

/// Host-mode door counts on the watch. Persisted in the watch App Group so a
/// host glancing down mid-event still sees the last known numbers when the
/// phone is briefly out of range — labelled as of when, never as live.
@MainActor
final class DoorStore: ObservableObject {
    static let appGroup = "group.com.dvnt.app.watch"
    static let storageKey = "dvnt.door.envelope"

    @Published private(set) var envelope: WatchDoorEnvelope = .empty

    private var defaults: UserDefaults? { UserDefaults(suiteName: Self.appGroup) }

    init() { load() }

    var door: WatchDoor? { envelope.door }
    var isEmpty: Bool { envelope.door == nil }

    var syncedAt: Date? {
        guard envelope.syncedAt > 0 else { return nil }
        return Date(timeIntervalSince1970: envelope.syncedAt)
    }

    /// Older than a minute and these numbers are not "live" any more. The
    /// dashboard law applies on the wrist too: a stale number is labelled
    /// stale, never shown as current.
    var isStale: Bool {
        guard let syncedAt else { return true }
        return Date().timeIntervalSince(syncedAt) > 60
    }

    func apply(_ envelope: WatchDoorEnvelope) {
        self.envelope = envelope
        persist(envelope)
    }

    func ingest(json data: Data) {
        guard let env = try? JSONDecoder().decode(WatchDoorEnvelope.self, from: data)
        else { return }
        apply(env)
    }

    private func persist(_ env: WatchDoorEnvelope) {
        guard let data = try? JSONEncoder().encode(env) else { return }
        defaults?.set(data, forKey: Self.storageKey)
    }

    private func load() {
        guard let data = defaults?.data(forKey: Self.storageKey),
              let env = try? JSONDecoder().decode(WatchDoorEnvelope.self, from: data)
        else { return }
        envelope = env
    }
}
