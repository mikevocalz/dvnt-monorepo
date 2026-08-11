import Foundation

/// Mirror of `WatchDMDTO` in
/// `packages/app/features/watch/watch-dm-payload.ts` — keep the two in lockstep.
///
/// A projection of the phone's conversation list, nothing more. There is no
/// thread history here and no DVNT session on this device: the wrist shows who
/// wants the member and carries one line back, and the phone does the sending.
struct WatchDM: Identifiable, Codable, Hashable {
    let id: String
    let name: String
    let handle: String
    /// Last message text — rendered verbatim, never truncated to fit chrome.
    let preview: String
    let timestamp: Double // epoch seconds
    let unread: Bool
    let isGroup: Bool
    /// Sender avatar for the Messages Door mosaic. Optional by design: a group
    /// has no single face and an avatar-less member is normal — AvatarMosaic
    /// fills the gap with the Deviant Gradient rather than grey.
    let avatarURL: String?

    enum CodingKeys: String, CodingKey {
        case id, name, handle, preview, timestamp, unread, isGroup, avatarURL
    }

    /// Lenient decode throughout: one malformed row must not blank the inbox.
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        name = (try? c.decode(String.self, forKey: .name)) ?? "DVNT"
        handle = (try? c.decode(String.self, forKey: .handle)) ?? ""
        preview = (try? c.decode(String.self, forKey: .preview)) ?? ""
        timestamp = (try? c.decode(Double.self, forKey: .timestamp)) ?? 0
        unread = (try? c.decode(Bool.self, forKey: .unread)) ?? false
        isGroup = (try? c.decode(Bool.self, forKey: .isGroup)) ?? false
        // Lenient like the rest: an older phone build sends no avatarURL at all.
        avatarURL = (try? c.decode(String.self, forKey: .avatarURL))
            .flatMap { $0.isEmpty ? nil : $0 }
    }

    var date: Date? { timestamp > 0 ? Date(timeIntervalSince1970: timestamp) : nil }
}

/// The whole conversation snapshot the phone sends, newest-first, with a sync stamp.
struct WatchDMEnvelope: Codable {
    let dms: [WatchDM]
    let syncedAt: Double

    static let empty = WatchDMEnvelope(dms: [], syncedAt: 0)
}
