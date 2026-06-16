import Foundation
import Combine

/// Single source of truth for the watch UI. Holds the last-synced ticket set,
/// persisted in the watch App Group so it survives launches and an unreachable
/// phone. Updated by `WatchConnectivityManager` when the phone pushes a new set.
@MainActor
final class TicketStore: ObservableObject {
    static let appGroup = "group.com.dvnt.app.watch"
    static let storageKey = "dvnt.tickets.envelope"

    @Published private(set) var envelope: WatchTicketEnvelope = .empty

    private var defaults: UserDefaults? { UserDefaults(suiteName: Self.appGroup) }

    init() { load() }

    /// Tickets grouped by event, sorted soonest-first; valid events float up.
    var groups: [EventGroup] {
        let byEvent = Dictionary(grouping: envelope.tickets, by: { $0.eventId })
        let groups = byEvent.map { eventId, tickets -> EventGroup in
            let first = tickets.first
            return EventGroup(
                id: eventId,
                title: first?.eventTitle ?? "Event",
                date: first?.eventDate.flatMap(Self.parseDate),
                location: first?.eventLocation,
                // Stable order inside a group: valid first, then by tier label.
                tickets: tickets.sorted { lhs, rhs in
                    if lhs.status.isPresentable != rhs.status.isPresentable {
                        return lhs.status.isPresentable
                    }
                    return (lhs.tierName ?? "") < (rhs.tierName ?? "")
                }
            )
        }
        return groups.sorted { a, b in
            if a.hasPresentable != b.hasPresentable { return a.hasPresentable }
            switch (a.date, b.date) {
            case let (.some(da), .some(db)): return da < db
            case (.some, .none): return true
            case (.none, .some): return false
            default: return a.title < b.title
            }
        }
    }

    var syncedAt: Date? {
        guard envelope.syncedAt > 0 else { return nil }
        return Date(timeIntervalSince1970: envelope.syncedAt)
    }

    var isEmpty: Bool { envelope.tickets.isEmpty }

    /// Next upcoming valid event — drives the complication countdown.
    var nextEvent: EventGroup? {
        groups.first { $0.hasPresentable }
    }

    // MARK: - Mutation

    func apply(_ envelope: WatchTicketEnvelope) {
        self.envelope = envelope
        persist(envelope)
    }

    /// Decode an incoming WCSession dictionary (`{"payload": "<json string>"}`)
    /// or raw JSON data.
    func ingest(json data: Data) {
        guard let env = try? JSONDecoder().decode(WatchTicketEnvelope.self, from: data) else { return }
        apply(env)
    }

    // MARK: - Persistence (App Group)

    private func persist(_ env: WatchTicketEnvelope) {
        guard let data = try? JSONEncoder().encode(env) else { return }
        defaults?.set(data, forKey: Self.storageKey)
    }

    private func load() {
        guard let data = defaults?.data(forKey: Self.storageKey),
              let env = try? JSONDecoder().decode(WatchTicketEnvelope.self, from: data)
        else { return }
        envelope = env
    }

    // MARK: - Helpers

    static func parseDate(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let d = f.date(from: iso) { return d }
        f.formatOptions = [.withInternetDateTime]
        return f.date(from: iso)
    }
}
