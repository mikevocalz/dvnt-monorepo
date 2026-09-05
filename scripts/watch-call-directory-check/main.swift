import Foundation
@main struct Checks {
    @MainActor static func main() {
        let suite = "dvnt.callDirectory.test.\(UUID().uuidString)"
        let defaults = UserDefaults(suiteName: suite)!
        defer { defaults.removePersistentDomain(forName: suite) }
        let person = WatchCallPerson(id: "2", name: "Recipient", avatarURL: nil)
        let store = CallDirectoryStore(defaults: defaults)
        store.resetAccount("A")
        store.apply(WatchCallDirectory(protocol: 2, accountGen: "A", syncedAt: 100, people: [person], recents: [], error: nil))
        store.start(["1","2","3","4"], video: false)
        precondition(store.pending == nil && store.message == "Choose one to three people.")
        store.start(["2"], video: false)
        precondition(store.pending == nil && store.message == "Open DVNT on your phone and retry.")
        store.apply(WatchCallDirectory(protocol: 2, accountGen: "A", syncedAt: 110, people: [], recents: [], error: "Offline"))
        precondition(store.envelope.people.count == 1)
        store.resetAccount("B")
        precondition(store.envelope.people.isEmpty && store.message == nil)
        let restarted = CallDirectoryStore(defaults: defaults)
        restarted.apply(WatchCallDirectory(protocol: 2, accountGen: "A", syncedAt: 1000, people: [person], recents: [], error: nil))
        precondition(restarted.envelope.accountGen == "B" && restarted.envelope.people.isEmpty)
        print("PASS recipient cap, offline handoff truth, cached error, account purge and retired replay")
    }
}
