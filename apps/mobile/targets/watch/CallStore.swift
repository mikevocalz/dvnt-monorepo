import Foundation
import Observation
import WatchKit

/// An incoming DVNT call, as the phone describes it. Mirrors `WatchCallDTO` in
/// `packages/app/features/watch/watch-call-payload.ts`.
///
/// Deliberately thin: the watch needs to know who is calling and what to send
/// back. It holds no room credentials, because it never joins the room — see
/// `CallStore` for why.
struct WatchIncomingCall: Codable, Hashable, Identifiable {
    let id: String              // the call_signals row id
    let `protocol`: Int?
    let accountGen: String?
    let callerName: String
    let callerAvatar: String?
    let isVideo: Bool
    let isGroup: Bool
    /// Epoch seconds, stamped by the phone. The watch clock can drift from the
    /// phone's, so expiry is measured against this rather than a local start.
    let ringingSince: Double

    var initial: String {
        String(callerName.prefix(1)).uppercased()
    }
}

/// Ringing state on the wrist.
///
/// Audio stays on iPhone in companion mode. watchOS supports CallKit and
/// PushKit; native DVNT transport remains gated on a supported SDK and device proof.
@MainActor @Observable
final class CallStore {
    /// Matches the 30s auto-dismiss in the phone's IncomingCallOverlay. If the
    /// two disagree, the wrist keeps ringing for a call the phone gave up on.
    static let ringTimeout: TimeInterval = 30

    private(set) var incoming: WatchIncomingCall?
    /// Set once the wearer answers, so the UI can say where the call actually is
    /// instead of leaving them holding a silent watch.
    private(set) var handedOff = false

    /// Sends the wearer's decision back to the phone. Injected so the store stays
    /// testable and does not reach into WCSession itself.
    var relay: ((_ callId: String, _ action: String) -> Void)?

    @ObservationIgnored private var haptics: Timer?
    @ObservationIgnored private var expiry: Timer?

    @ObservationIgnored private var tombstones: [String: Double] = UserDefaults.standard.dictionary(forKey: "dvnt.call.ended") as? [String: Double] ?? [:]

    // MARK: - Inbound

    func present(_ call: WatchIncomingCall) {
        // A second ring for the same call (both transports fired) must not
        // restart the haptic loop or extend the timeout.
        let now = Date().timeIntervalSince1970
        tombstones = tombstones.filter { $0.value > now }
        guard incoming?.id != call.id, tombstones[call.id] == nil else { return }

        // Honour the phone's clock: a signal that sat in the transfer queue past
        // the timeout is already dead and must never ring.
        let age = Date().timeIntervalSince1970 - call.ringingSince
        guard call.ringingSince > 0, age >= -5, age < Self.ringTimeout else { return }

        incoming = call
        handedOff = false
        startRinging(remaining: call.ringingSince == 0 ? Self.ringTimeout : Self.ringTimeout - age)
    }

    /// The phone answered, declined, or the caller hung up elsewhere.
    func clear(callId: String? = nil) {
        if let ended = callId ?? incoming?.id {
            tombstones[ended] = Date().timeIntervalSince1970 + 300
            UserDefaults.standard.set(tombstones, forKey: "dvnt.call.ended")
        }
        if let callId, incoming?.id != callId { return }
        stopRinging()
        incoming = nil
        handedOff = false
    }

    // MARK: - Outbound

    func accept() {
        guard let call = incoming else { return }
        stopRinging()
        relay?(call.id, call.isVideo ? "accept_audio_only" : "accept")
        // Stay on screen with the hand-off note; the phone clears us when the
        // call actually connects.
        handedOff = true
        expiry = Timer.scheduledTimer(withTimeInterval: 30, repeats: false) { _ in
            Task { @MainActor in self.clear() }
        }
    }

    func decline() {
        guard let call = incoming else { return }
        stopRinging()
        WKInterfaceDevice.current().play(.failure)
        relay?(call.id, "decline")
        clear(callId: call.id)
    }

    // MARK: - Ring

    /// A repeating `.notification` rather than one buzz. A single tap is missed
    /// on a wrist in a loud room, which is the room this app is used in.
    private func startRinging(remaining: TimeInterval) {
        WKInterfaceDevice.current().play(.notification)
        haptics = Timer.scheduledTimer(withTimeInterval: 2.4, repeats: true) { _ in
            Task { @MainActor in WKInterfaceDevice.current().play(.notification) }
        }
        expiry = Timer.scheduledTimer(withTimeInterval: max(remaining, 1), repeats: false) { _ in
            Task { @MainActor in self.clear() }
        }
    }

    private func stopRinging() {
        haptics?.invalidate()
        haptics = nil
        expiry?.invalidate()
        expiry = nil
    }
}
