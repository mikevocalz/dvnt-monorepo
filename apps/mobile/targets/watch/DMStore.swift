import Foundation
import Combine

/// Source of truth for conversation previews on the watch. Holds the last-synced
/// set, persisted in the watch App Group so the inbox still reads with the phone
/// out of range. Updated by `WatchConnectivityManager` when the phone pushes.
///
/// Replies do not live here: `relay` hands the typed line straight back to the
/// phone, which owns the send. Nothing is queued on this device, because a
/// message that leaves the wrist hours later reads as a bug to whoever gets it.
@MainActor
final class DMStore: ObservableObject {
    static let appGroup = "group.com.dvnt.app.watch"
    static let storageKey = "dvnt.dms.envelope"

    @Published private(set) var envelope: WatchDMEnvelope = .empty
    /// Set by `WatchConnectivityManager`. `(conversationId, text)`.
    var relay: ((String, String) -> Void)?

    private var defaults: UserDefaults? { UserDefaults(suiteName: Self.appGroup) }

    init() { load() }

    /// All conversations, newest first.
    var dms: [WatchDM] { envelope.dms.sorted { $0.timestamp > $1.timestamp } }

    var isEmpty: Bool { envelope.dms.isEmpty }

    var unreadCount: Int { envelope.dms.filter { $0.unread }.count }

    var syncedAt: Date? {
        guard envelope.syncedAt > 0 else { return nil }
        return Date(timeIntervalSince1970: envelope.syncedAt)
    }

    /// IDs of currently-unread threads — callers diff before/after to fire one
    /// arrival haptic for genuinely new messages rather than for a backfill.
    var unreadIds: Set<String> {
        Set(envelope.dms.filter { $0.unread }.map { $0.id })
    }

    // MARK: - Mutation

    func apply(_ envelope: WatchDMEnvelope) {
        self.envelope = envelope
        persist(envelope)
    }

    func ingest(json data: Data) {
        guard let env = try? JSONDecoder().decode(WatchDMEnvelope.self, from: data) else { return }
        apply(env)
    }

    /// Send what the wearer typed. Empty input is dropped here rather than
    /// travelling to the phone to be rejected.
    func send(conversationId: String, text: String) {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty else { return }
        relay?(conversationId, body)
    }

    // MARK: - Persistence (App Group)

    private func persist(_ env: WatchDMEnvelope) {
        guard let data = try? JSONEncoder().encode(env) else { return }
        defaults?.set(data, forKey: Self.storageKey)
    }

    private func load() {
        guard let data = defaults?.data(forKey: Self.storageKey),
              let env = try? JSONDecoder().decode(WatchDMEnvelope.self, from: data)
        else { return }
        envelope = env
    }
}
