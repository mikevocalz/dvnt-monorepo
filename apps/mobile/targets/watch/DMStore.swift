import Foundation
import Observation

/// Account-scoped cache and durable outbox. Only a backend result marks a send
/// successful; live transport timeouts retain the same operation for retry.
@MainActor @Observable
final class DMStore {
    static let appGroup = "group.com.dvnt.app.watch"
    static let storageKey = "dvnt.dms.envelope"
    private(set) var envelope: WatchDMEnvelope = .empty
    private(set) var pages: [String: WatchThreadPage] = [:]
    private(set) var outbox: [WatchOutboxItem] = []
    private(set) var loading: Set<String> = []
    private(set) var errors: [String: String] = [:]
    var drafts: [String: String] = [:] { didSet { persistState() } }
    var anchors: [String: String] = [:] { didSet { persistState() } }
    @ObservationIgnored var relay: ((WatchSendCommand) -> Bool)?
    @ObservationIgnored var loadThread: ((String, WatchCursor?) -> Void)?
    @ObservationIgnored var onAccountReset: (() -> Void)?
    private(set) var threadActions: [String: WatchThreadAction] = [:]
    private(set) var actionStatus: [String: String] = [:]
    @ObservationIgnored var actionRelay: ((WatchThreadAction, @escaping (Bool, String?) -> Void) -> Bool)?
    @ObservationIgnored var onSent: (() -> Void)?
    @ObservationIgnored private var defaults: UserDefaults?
    @ObservationIgnored private var retiredGenerations: Set<String> = []

    init(defaults: UserDefaults? = UserDefaults(suiteName: "group.com.dvnt.app.watch")) {
        self.defaults = defaults
        if let data = defaults?.data(forKey: Self.storageKey),
           let env = try? JSONDecoder().decode(WatchDMEnvelope.self, from: data) { envelope = env }
        retiredGenerations = Set(defaults?.stringArray(forKey: "dvnt.dms.retired") ?? [])
        if let data = defaults?.data(forKey: "dvnt.dms.state"),
           let state = try? JSONDecoder().decode(CachedState.self, from: data), state.accountGen == envelope.accountGen {
            pages = state.pages; outbox = state.outbox; drafts = state.drafts; anchors = state.anchors
            for i in outbox.indices where outbox[i].state == "sending" {
                outbox[i].state = "failed"; outbox[i].error = "Send interrupted. Retry to confirm."
            }
        }
    }

    var dms: [WatchDM] { envelope.dms.sorted { $0.timestamp > $1.timestamp } }
    var isEmpty: Bool { envelope.dms.isEmpty }
    var unreadCount: Int { envelope.dms.filter { $0.unread }.count }
    var syncedAt: Date? { envelope.syncedAt > 0 ? Date(timeIntervalSince1970: envelope.syncedAt) : nil }
    var unreadIds: Set<String> { Set(envelope.dms.filter { $0.unread }.map(\.id)) }
    var recentAvatarURLs: [String] {
        dms.compactMap(\.avatarURL).reduce(into: []) { result, url in
            if result.count < 4 && !result.contains(url) { result.append(url) }
        }
    }

    func apply(_ next: WatchDMEnvelope) {
        guard next.protocol == 1 || next.protocol == 2, next.syncedAt >= envelope.syncedAt else { return }
        if envelope.protocol == 2 && next.protocol != 2 { return }
        if next.protocol == 2 && (next.accountGen.isEmpty || retiredGenerations.contains(next.accountGen)) { return }
        if next.status == "error" {
            if next.accountGen != envelope.accountGen { resetAccount(next.accountGen) }
            var failed = envelope
            failed.status = "error"; failed.error = next.error ?? "Couldn’t refresh messages. Retry."
            envelope = failed
            if let data = try? JSONEncoder().encode(failed) { defaults?.set(data, forKey: Self.storageKey) }
            return
        }
        if next.accountGen != envelope.accountGen || next.dms.isEmpty {
            if !envelope.accountGen.isEmpty && next.accountGen != envelope.accountGen {
                retiredGenerations.insert(envelope.accountGen)
                defaults?.set(Array(retiredGenerations), forKey: "dvnt.dms.retired")
            }
            onAccountReset?()
            pages = [:]; outbox = []; drafts = [:]; anchors = [:]; errors = [:]; loading = []
            threadActions = [:]; actionStatus = [:]
        }
        let authorized = Set(next.dms.map(\.id))
        let removed = !Set(envelope.dms.map(\.id)).subtracting(authorized).isEmpty ||
            pages.keys.contains { !authorized.contains($0) } || outbox.contains { !authorized.contains($0.command.conversationId) }
        pages = pages.filter { authorized.contains($0.key) }
        outbox = outbox.filter { authorized.contains($0.command.conversationId) }
        drafts = drafts.filter { authorized.contains($0.key) }
        anchors = anchors.filter { authorized.contains($0.key) }
        errors = errors.filter { authorized.contains($0.key) }
        loading = loading.intersection(authorized)
        threadActions = threadActions.filter { authorized.contains($0.key) }
        actionStatus = actionStatus.filter { authorized.contains($0.key) }
        if removed { onAccountReset?() }
        envelope = next
        if let data = try? JSONEncoder().encode(next) { defaults?.set(data, forKey: Self.storageKey) }
        persistState()
    }

    /// Clear independently of a snapshot; zero does not suppress the next real envelope.
    func resetAccount(_ accountGen: String) {
        if !envelope.accountGen.isEmpty && envelope.accountGen != accountGen {
            retiredGenerations.insert(envelope.accountGen)
            defaults?.set(Array(retiredGenerations), forKey: "dvnt.dms.retired")
        }
        pages = [:]; outbox = []; drafts = [:]; anchors = [:]; errors = [:]; loading = []
        threadActions = [:]; actionStatus = [:]
        var empty = WatchDMEnvelope.empty
        empty.protocol = 2; empty.accountGen = accountGen
        envelope = empty
        if let data = try? JSONEncoder().encode(empty) { defaults?.set(data, forKey: Self.storageKey) }
        persistState()
        onAccountReset?()
    }

    func ingest(json data: Data) {
        guard let next = try? JSONDecoder().decode(WatchDMEnvelope.self, from: data) else { return }
        apply(next)
    }

    func performThreadAction(_ id: String, messageId: String? = nil, emoji: String? = nil, desiredPresent: Bool? = nil) {
        guard envelope.protocol == 2, envelope.dms.contains(where: { $0.id == id }), actionStatus[id] != "Updating…" else { return }
        let now = Date().timeIntervalSince1970
        let command = WatchThreadAction(protocol: 2, accountGen: envelope.accountGen, type: "threadAction",
            action: messageId == nil ? "read" : "reaction", conversationId: id, messageId: messageId,
            emoji: emoji, desiredPresent: desiredPresent, issuedAt: now, expiresAt: now + 60)
        threadActions[id] = command
        actionStatus[id] = "Updating…"
        let completion: (Bool, String?) -> Void = { [weak self] ok, error in
            guard let self, self.envelope.accountGen == command.accountGen,
                  self.threadActions[id]?.issuedAt == command.issuedAt else { return }
            self.actionStatus[id] = ok ? "Updated" : (error ?? "Couldn’t update. Retry.")
            if ok { self.threadActions[id] = nil; self.requestThread(id) }
        }
        if actionRelay?(command, completion) != true { completion(false, "iPhone unavailable. Retry when connected.") }
        Task { [weak self] in
            try? await Task.sleep(for: .seconds(22))
            guard let self, self.actionStatus[id] == "Updating…",
                  self.threadActions[id]?.issuedAt == command.issuedAt else { return }
            completion(false, "Update not confirmed. Retry.")
        }
    }

    func retryThreadAction(_ id: String) {
        guard let command = threadActions[id] else { return }
        performThreadAction(id, messageId: command.messageId, emoji: command.emoji, desiredPresent: command.desiredPresent)
    }

    func requestThread(_ id: String, older: Bool = false) {
        guard !loading.contains(id), envelope.protocol == 2, envelope.dms.contains(where: { $0.id == id }), let loadThread else { return }
        loading.insert(id); errors[id] = nil
        loadThread(id, older ? pages[id]?.olderCursor : nil)
    }

    func receive(_ page: WatchThreadPage, older: Bool) {
        guard page.protocol == 2, page.accountGen == envelope.accountGen, envelope.dms.contains(where: { $0.id == page.conversationId }) else { return }
        loading.remove(page.conversationId); errors[page.conversationId] = nil
        let existing = pages[page.conversationId]
        var merged = Dictionary(uniqueKeysWithValues: (existing?.messages ?? []).map { ($0.id, $0) })
        for message in page.messages { merged[message.id] = message }
        let messages = merged.values.sorted { $0.createdAt == $1.createdAt ? ($0.id.count == $1.id.count ? $0.id < $1.id : $0.id.count < $1.id.count) : $0.createdAt < $1.createdAt }
        let window = older ? Array(messages.prefix(200)) : Array(messages.suffix(200))
        let trimmedOlder = !older && messages.count > window.count
        let cursor = trimmedOlder ? window.first.map { WatchCursor(createdAt: $0.createdAt, id: $0.id) }
            : (older || existing == nil ? page.olderCursor : existing?.olderCursor)
        pages[page.conversationId] = WatchThreadPage(protocol: 2, accountGen: page.accountGen,
            conversationId: page.conversationId, messages: window, olderCursor: cursor)
        persistState()
    }

    func threadFailed(_ id: String, error: String) { loading.remove(id); errors[id] = error }

    func send(conversationId: String, text: String) {
        let body = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !body.isEmpty, body.utf16.count <= 500, envelope.protocol == 2,
              envelope.dms.contains(where: { $0.id == conversationId }) else { return }
        let now = Date().timeIntervalSince1970
        let command = WatchSendCommand(protocol: 2, accountGen: envelope.accountGen,
            operationId: UUID().uuidString, type: "dmReply", conversationId: conversationId,
            text: body, issuedAt: now, expiresAt: now + 86400)
        outbox.removeAll { item in item.state == "sent" && pages[item.command.conversationId]?.messages.contains(where: { $0.id == item.serverId }) == true }
        guard outbox.count < 50 else { errors[conversationId] = "Outbox is full. Retry or cancel queued messages first."; return }
        outbox.append(WatchOutboxItem(command: command, state: "queued"))
        drafts[conversationId] = nil
        persistState()
        dispatch(command.id)
    }

    func retry(_ id: String) { dispatch(id) }
    func cancel(_ id: String) {
        guard let item = outbox.first(where: { $0.id == id }), item.state == "queued" else { return }
        outbox.removeAll { $0.id == id }; persistState()
    }
    func flushQueued() { for item in outbox where item.state == "queued" { dispatch(item.id) } }

    private func dispatch(_ id: String) {
        guard let i = outbox.firstIndex(where: { $0.id == id }), outbox[i].state != "sent",
              outbox[i].state != "sending" else { return }
        guard outbox[i].command.expiresAt > Date().timeIntervalSince1970 else {
            outbox[i].state = "failed"; outbox[i].error = "Message expired. Compose it again."; persistState(); return
        }
        if relay?(outbox[i].command) == true { outbox[i].state = "sending"; outbox[i].error = nil }
        persistState()
    }

    func failSend(_ id: String, error: String) {
        guard let i = outbox.firstIndex(where: { $0.id == id }), outbox[i].state != "sent" else { return }
        outbox[i].state = "failed"; outbox[i].error = error; persistState()
    }

    func receive(_ result: WatchCommandResult) {
        guard result.protocol == 2, result.accountGen == envelope.accountGen,
              let i = outbox.firstIndex(where: { $0.id == result.operationId }), outbox[i].state != "sent" else { return }
        guard result.status != "sent" || result.serverId != nil else { return }
        outbox[i].state = result.status == "sent" ? "sent" : "failed"
        outbox[i].serverId = result.serverId; outbox[i].error = result.error
        persistState()
        if result.status == "sent" { onSent?(); requestThread(outbox[i].command.conversationId) }
    }

    private struct CachedState: Codable {
        let accountGen: String
        let pages: [String: WatchThreadPage]
        let outbox: [WatchOutboxItem]
        let drafts: [String: String]
        let anchors: [String: String]
    }
    private func persistState() {
        let state = CachedState(accountGen: envelope.accountGen, pages: pages, outbox: outbox, drafts: drafts, anchors: anchors)
        if let data = try? JSONEncoder().encode(state) { defaults?.set(data, forKey: "dvnt.dms.state") }
    }
}
