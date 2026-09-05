import Foundation
@main struct Checks {
    @MainActor static func main() {
        let now = Date().timeIntervalSince1970
        func call(_ gen: String, _ stamp: Double, _ phase: String = "connected") -> WatchActiveCallEnvelope {
            WatchActiveCallEnvelope(protocol: 2, accountGen: gen, syncedAt: stamp, expiresAt: stamp + 30, roomId: "room", phase: phase, peerStatus: "connected", name: "Caller", isVideo: false, muted: false, canMute: true)
        }
        let store = ActiveCallStore()
        store.resetAccount("A"); store.apply(call("A", now))
        precondition(store.call != nil && store.presented)
        store.act("set_muted", muted: true)
        precondition(store.call?.muted == false && store.message != nil && store.pending == nil)
        store.dismiss(); store.apply(call("A", now + 1))
        precondition(!store.presented)
        store.apply(call("A", now + 2, "ended"))
        precondition(store.call == nil && !store.presented)
        store.apply(call("A", now + 1))
        precondition(store.call == nil)
        store.resetAccount("B"); store.apply(call("A", now + 5))
        precondition(store.call == nil && store.generation == "B")
        store.apply(call("B", now - 60))
        precondition(store.call == nil)
        print("PASS live overlay, truthful failed mute, dismissed heartbeat, end restore, ordering, account replay, expiry")
    }
}
