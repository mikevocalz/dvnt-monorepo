import Foundation
import Combine

/// Source of truth for host broadcasts on the watch. Holds the last-synced set,
/// persisted in the watch App Group so a member who missed the buzz can still
/// scroll what the host said — even with the phone unreachable. Updated by
/// `WatchConnectivityManager` when the phone pushes a new snapshot.
@MainActor
final class BroadcastStore: ObservableObject {
    static let appGroup = "group.com.dvnt.app.watch"
    static let storageKey = "dvnt.broadcasts.envelope"

    @Published private(set) var envelope: WatchBroadcastEnvelope = .empty

    private var defaults: UserDefaults? { UserDefaults(suiteName: Self.appGroup) }

    init() { load() }

    /// All broadcasts, newest first.
    var broadcasts: [WatchBroadcast] {
        envelope.broadcasts.sorted { $0.createdAt > $1.createdAt }
    }

    var isEmpty: Bool { envelope.broadcasts.isEmpty }

    var unreadCount: Int { envelope.broadcasts.filter { !$0.read }.count }

    var syncedAt: Date? {
        guard envelope.syncedAt > 0 else { return nil }
        return Date(timeIntervalSince1970: envelope.syncedAt)
    }

    /// Broadcasts for one event — drives the per-ticket "Messages from host" view.
    func broadcasts(forEvent eventId: String) -> [WatchBroadcast] {
        broadcasts.filter { $0.eventId == eventId }
    }

    /// The most recent broadcast for an event that is happening around now —
    /// feeds an optional complication "Host: …" glance.
    func latest(forEvent eventId: String) -> WatchBroadcast? {
        broadcasts(forEvent: eventId).first
    }

    // MARK: - Mutation

    func apply(_ envelope: WatchBroadcastEnvelope) {
        self.envelope = envelope
        persist(envelope)
    }

    func ingest(json data: Data) {
        guard let env = try? JSONDecoder().decode(WatchBroadcastEnvelope.self, from: data) else { return }
        apply(env)
    }

    /// IDs of currently-unread broadcasts — used to fire a single arrival haptic
    /// only for genuinely new messages (callers diff before/after).
    var unreadIds: Set<String> {
        Set(envelope.broadcasts.filter { !$0.read }.map { $0.id })
    }

    // MARK: - Persistence (App Group)

    private func persist(_ env: WatchBroadcastEnvelope) {
        guard let data = try? JSONEncoder().encode(env) else { return }
        defaults?.set(data, forKey: Self.storageKey)
    }

    private func load() {
        guard let data = defaults?.data(forKey: Self.storageKey),
              let env = try? JSONDecoder().decode(WatchBroadcastEnvelope.self, from: data)
        else { return }
        envelope = env
    }
}
