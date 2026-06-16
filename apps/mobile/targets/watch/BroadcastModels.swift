import SwiftUI
import WatchKit

/// A host broadcast as the phone projects it. Mirrors `WatchBroadcastDTO` in
/// `packages/app/src/watch/watch-broadcast-payload.ts` — keep the two in lockstep.
///
/// These are the SAME rows the phone shows in its activity feed (the
/// `event-broadcast-message` edge function): the watch is a presentation surface,
/// not a new pipeline. Delivery is already audience-scoped server-side, so every
/// row here is one this member was legitimately in the audience for.
struct WatchBroadcast: Identifiable, Codable, Hashable {
    let id: String
    let eventId: String
    let eventTitle: String
    let host: String
    let title: String?
    /// The host's message — rendered VERBATIM. Never truncated to fit chrome.
    let body: String
    let intent: BroadcastIntent
    let createdAt: Double   // epoch seconds
    let read: Bool

    enum CodingKeys: String, CodingKey {
        case id, eventId, eventTitle, host, title, body, intent, createdAt, read
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        eventId = (try? c.decode(String.self, forKey: .eventId)) ?? ""
        eventTitle = (try? c.decode(String.self, forKey: .eventTitle)) ?? "Event"
        host = (try? c.decode(String.self, forKey: .host)) ?? "Host"
        title = try? c.decode(String.self, forKey: .title)
        body = (try? c.decode(String.self, forKey: .body)) ?? ""
        // Re-derive intent defensively if the phone omitted/garbled it — styling only.
        let raw = (try? c.decode(String.self, forKey: .intent)) ?? ""
        intent = BroadcastIntent(rawValue: raw) ?? BroadcastIntent.infer(from: body)
        createdAt = (try? c.decode(Double.self, forKey: .createdAt)) ?? 0
        read = (try? c.decode(Bool.self, forKey: .read)) ?? false
    }

    var date: Date? { createdAt > 0 ? Date(timeIntervalSince1970: createdAt) : nil }
}

/// Coarse intent — STYLING ONLY (glyph + accent + haptic weight). The host's text
/// is sacrosanct; intent never changes what is shown, only how the chrome frames
/// it. Mirrors `WatchBroadcastIntent` in watch-broadcast-payload.ts.
enum BroadcastIntent: String, Codable {
    case urgent
    case directional
    case general

    /// Conservative inference fallback — defaults to `.general`; invents nothing.
    static func infer(from text: String) -> BroadcastIntent {
        let t = text.lowercased()
        let urgent = ["now", "starting", "start", "begin", "5 min", "five min",
                      "last call", "doors", "closing", "hurry", "tonight"]
        let directional = ["front", "stage", "vip", "back", "entrance", "gate",
                           "move", "head", "to the", "upstairs", "downstairs", "floor"]
        if urgent.contains(where: { t.contains($0) }) { return .urgent }
        if directional.contains(where: { t.contains($0) }) { return .directional }
        return .general
    }

    var glyph: String {
        switch self {
        case .urgent: return "clock.badge.exclamationmark.fill"
        case .directional: return "arrow.up.forward.circle.fill"
        case .general: return "megaphone.fill"
        }
    }

    var accent: Color {
        switch self {
        case .urgent: return Color(hex: 0x379ed8)       // brand bright teal
        case .directional: return Color(hex: 0x874e9f)  // brand purple
        case .general: return Color(hex: 0x3397ce)      // brand accent
        }
    }

    /// One deliberate haptic on arrival; urgent gets the heavier `.notification`.
    var haptic: WKHapticType {
        switch self {
        case .urgent: return .notification
        default: return .click
        }
    }
}

/// The whole broadcast snapshot the phone sends, newest-first, with a sync stamp.
struct WatchBroadcastEnvelope: Codable {
    let broadcasts: [WatchBroadcast]
    let syncedAt: Double

    static let empty = WatchBroadcastEnvelope(broadcasts: [], syncedAt: 0)
}
