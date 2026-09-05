import Foundation

@main struct DMStoreTests {
    @MainActor static func main() throws {
        let name = "dvnt.watch.tests.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: name)!
        defer { defaults.removePersistentDomain(forName: name) }
        let store = DMStore(defaults: defaults)
        let json = #"{"protocol":2,"accountGen":"a","syncedAt":100,"dms":[{"id":"1","name":"Test","timestamp":99}],"quickReplies":["On my way"]}"#
        store.ingest(json: Data(json.utf8))
        precondition(store.dms.count == 1 && store.envelope.accountGen == "a")
        store.drafts["1"] = "keep draft"
        store.ingest(json: Data(#"{"protocol":2,"accountGen":"a","syncedAt":100,"dms":[],"status":"error","error":"Network failed"}"#.utf8))
        precondition(store.dms.count == 1 && store.drafts["1"] == "keep draft" && store.envelope.syncedAt == 100)
        precondition(store.envelope.error == "Network failed")
        store.ingest(json: Data(json.utf8))
        store.send(conversationId: "1", text: " hello ")
        precondition(store.outbox.count == 1 && store.outbox[0].state == "queued")
        let command = store.outbox[0].command
        precondition(command.text == "hello")
        var attempts: [String] = []
        store.relay = { attempts.append($0.id); return true }
        store.flushQueued()
        precondition(store.outbox[0].state == "sending" && attempts == [command.id])
        store.retry(command.id)
        precondition(attempts.count == 1)
        store.failSend(command.id, error: "timeout")
        store.retry(command.id)
        precondition(attempts == [command.id, command.id])
        var haptics = 0
        store.onSent = { haptics += 1 }
        store.receive(WatchCommandResult(protocol: 2, accountGen: "old", operationId: command.id, status: "sent", serverId: "22", error: nil))
        precondition(haptics == 0 && store.outbox[0].state == "sending")
        let sent = WatchCommandResult(protocol: 2, accountGen: "a", operationId: command.id, status: "sent", serverId: "22", error: nil)
        store.receive(sent); store.receive(sent)
        precondition(haptics == 1 && store.outbox[0].serverId == "22")
        store.failSend(command.id, error: "late timeout")
        precondition(store.outbox[0].state == "sent")
        store.send(conversationId: "1", text: "persist")
        let restored = DMStore(defaults: defaults)
        precondition(restored.outbox.last?.state == "failed")
        precondition(restored.outbox.last?.command.id == store.outbox.last?.command.id)
        store.relay = nil
        store.send(conversationId: "1", text: "cancel")
        let cancelled = store.outbox.last!.id
        store.cancel(cancelled)
        precondition(!store.outbox.contains { $0.id == cancelled })
        store.send(conversationId: "foreign", text: "reject")
        precondition(!store.outbox.contains { $0.command.conversationId == "foreign" })
        store.ingest(json: Data(json.replacingOccurrences(of: "\"a\"", with: "\"b\"").replacingOccurrences(of: ":100", with: ":101").utf8))
        precondition(store.outbox.isEmpty && store.pages.isEmpty && store.envelope.accountGen == "b")
        store.ingest(json: Data(json.replacingOccurrences(of: ":100", with: ":200").utf8))
        precondition(store.envelope.accountGen == "b")
        store.ingest(json: Data("{bad".utf8))
        precondition(store.envelope.accountGen == "b")
        let pairJSON = #"{"protocol":2,"accountGen":"b","syncedAt":300,"dms":[{"id":"1","name":"Test","timestamp":99},{"id":"2","name":"Other","timestamp":98}]}"#
        store.ingest(json: Data(pairJSON.utf8))
        let message = WatchMessage(id: "m1", conversationId: "1", senderId: "self", senderName: nil, outgoing: true, text: "fixture", createdAt: "2026-09-05T00:00:00Z", attachments: [])
        let page = WatchThreadPage(protocol: 2, accountGen: "b", conversationId: "1", messages: [message], olderCursor: nil)
        store.receive(page, older: false)
        store.receive(WatchThreadPage(protocol: 2, accountGen: "b", conversationId: "2", messages: [], olderCursor: nil), older: false)
        store.drafts["1"] = "remove"; store.drafts["2"] = "retain"
        store.send(conversationId: "1", text: "remove outbox")
        store.send(conversationId: "2", text: "retain outbox")
        store.drafts["1"] = "remove"; store.drafts["2"] = "retain"
        var purges = 0; store.onAccountReset = { purges += 1 }
        store.ingest(json: Data(#"{"protocol":2,"accountGen":"b","syncedAt":301,"dms":[{"id":"2","name":"Other","timestamp":98}]}"#.utf8))
        precondition(store.pages["1"] == nil && store.pages["2"] != nil && store.drafts["1"] == nil && store.drafts["2"] == "retain")
        precondition(store.outbox.allSatisfy { $0.command.conversationId == "2" } && !store.outbox.isEmpty && purges == 1)
        store.receive(page, older: false)
        precondition(store.pages["1"] == nil)
        store.drafts["1"] = "private draft"
        store.resetAccount("c")
        precondition(store.drafts.isEmpty && store.outbox.isEmpty && store.envelope.syncedAt == 0)
        store.ingest(json: Data(json.replacingOccurrences(of: "\"a\"", with: "\"c\"").utf8))
        precondition(store.dms.count == 1 && store.envelope.syncedAt == 100)
        var actions: [WatchThreadAction] = []
        var complete: ((Bool, String?) -> Void)?
        store.actionRelay = { command, callback in actions.append(command); complete = callback; return true }
        store.performThreadAction("1", messageId: "22", emoji: "❤️", desiredPresent: true)
        precondition(store.actionStatus["1"] == "Updating…")
        complete?(false, "timeout")
        store.retryThreadAction("1")
        precondition(actions.count == 2 && actions.allSatisfy { $0.desiredPresent == true })
        complete?(true, nil)
        precondition(store.actionStatus["1"] == "Updated" && store.threadActions["1"] == nil)
        store.performThreadAction("1")
        store.resetAccount("d")
        complete?(true, nil)
        precondition(store.actionStatus.isEmpty)
        precondition(DMStore(defaults: defaults).envelope.accountGen == "d")
        print("DMStore: persisted send, retry identity, stale account, duplicate result, cancellation and decode checks passed")
    }
}
