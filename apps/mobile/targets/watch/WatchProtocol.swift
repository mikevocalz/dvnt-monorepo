import Foundation

struct WatchAttachment: Codable, Hashable, Identifiable {
    let id: String
    let kind: String
    let thumbURL: String?
    let fullURL: String?
    let alt: String?
}

struct WatchMessage: Codable, Hashable, Identifiable {
    let id: String
    let conversationId: String
    let senderId: String
    let senderName: String?
    let outgoing: Bool
    let text: String
    let createdAt: String
    let attachments: [WatchAttachment]
    var reactions: [WatchReaction]? = nil
}

struct WatchCursor: Codable, Hashable {
    let createdAt: String
    let id: String
}

struct WatchThreadPage: Codable {
    let `protocol`: Int
    let accountGen: String
    let conversationId: String
    let messages: [WatchMessage]
    let olderCursor: WatchCursor?
}

struct WatchSendCommand: Codable, Identifiable {
    let `protocol`: Int
    let accountGen: String
    let operationId: String
    let type: String
    let conversationId: String
    let text: String
    let issuedAt: Double
    let expiresAt: Double
    var id: String { operationId }
}

struct WatchCommandResult: Codable {
    let `protocol`: Int
    let accountGen: String
    let operationId: String
    let status: String
    let serverId: String?
    let error: String?
}

struct WatchOutboxItem: Codable, Identifiable {
    let command: WatchSendCommand
    var state: String
    var error: String?
    var serverId: String?
    var id: String { command.id }
}

struct WatchReaction: Codable, Hashable {
    let emoji: String
    let count: Int
    let mine: Bool
}
struct WatchThreadAction: Codable {
    let `protocol`: Int
    let accountGen: String
    let type: String
    let action: String
    let conversationId: String
    let messageId: String?
    let emoji: String?
    let desiredPresent: Bool?
    let issuedAt: Double
    let expiresAt: Double
}
