import Foundation
struct WatchCallPerson: Codable, Identifiable, Hashable { let id: String; let name: String; let avatarURL: String? }
struct WatchCallRecent: Codable, Identifiable { let id: String; let people: [WatchCallPerson]; let createdAt: String; let direction: String; let status: String; let isVideo: Bool }
struct WatchCallDirectory: Codable {
    let `protocol`: Int; let accountGen: String; let syncedAt: Double
    let people: [WatchCallPerson]; let recents: [WatchCallRecent]; let error: String?
    static let empty = WatchCallDirectory(protocol: 2, accountGen: "", syncedAt: 0, people: [], recents: [], error: nil)
}
struct WatchCallDirectoryCommand: Codable {
    let `protocol`: Int; let accountGen: String; let operationId: String; let type: String
    let action: String; let query: String?; let participantIds: [String]?; let callType: String?
    let issuedAt: Double; let expiresAt: Double
}
struct WatchCallDirectoryResult: Codable {
    let `protocol`: Int; let accountGen: String; let operationId: String; let status: String
    let people: [WatchCallPerson]?; let message: String?
}
