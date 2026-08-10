import Foundation
import Combine
import WatchKit

/// An incoming DVNT call, as the phone describes it. Mirrors `WatchCallDTO` in
/// `packages/app/features/watch/watch-call-payload.ts`.
///
/// Deliberately thin: the watch needs to know who is calling and what to send
/// back. It holds no room credentials, because it never joins the room — see
/// `CallStore` for why.
struct WatchIncomingCall: Codable, Hashable, Identifiable {
    let id: String              // the call_signals row id
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
/// **The watch is a remote control, not an endpoint.** watchOS has no WebRTC
/// stack and no public API that lets a third-party app hold a duplex audio
/// session with a remote peer, so a Fishjam room cannot be joined here — no SDK
/// would change that. What the wrist genuinely delivers is the decision: see who
/// is calling and accept or decline without digging the phone out. The phone
/// does the joining, and the UI says so rather than implying otherwise.
@MainActor
final class CallStore: ObservableObject {
    /// Matches the 30s auto-dismiss in the phone's IncomingCallOverlay. If the
    /// two disagree, the wrist keeps ringing for a call the phone gave up on.
    static let ringTimeout: TimeInterval = 30

    @Published private(set) var incoming: WatchIncomingCall?
    /// Set once the wearer answers, so the UI can say where the call actually is
    /// instead of leaving them holding a silent watch.
    @Published private(set) var handedOff = false

    /// Sends the wearer's decision back to the phone. Injected so the store stays
    /// testable and does not reach into WCSession itself.
    var relay: ((_ callId: String, _ action: String) -> Void)?

    private var haptics: Timer?
    private var expiry: Timer?

    // MARK: - Inbound

    func present(_ call: WatchIncomingCall) {
        // A second ring for the same call (both transports fired) must not
        // restart the haptic loop or extend the timeout.
        guard incoming?.id != call.id else { return }

        // Honour the phone's clock: a signal that sat in the transfer queue past
        // the timeout is already dead and must never ring.
        let age = Date().timeIntervalSince1970 - call.ringingSince
        guard call.ringingSince == 0 || age < Self.ringTimeout else { return }

        incoming = call
        handedOff = false
        startRinging(remaining: call.ringingSince == 0 ? Self.ringTimeout : Self.ringTimeout - age)
    }

    /// The phone answered, declined, or the caller hung up elsewhere.
    func clear(callId: String? = nil) {
        if let callId, incoming?.id != callId { return }
        stopRinging()
        incoming = nil
        handedOff = false
    }

    // MARK: - Outbound

    func accept() {
        guard let call = incoming else { return }
        stopRinging()
        WKInterfaceDevice.current().play(.success)
        relay?(call.id, "accept")
        // Stay on screen with the hand-off note; the phone clears us when the
        // call actually connects.
        handedOff = true
    }

    func decline() {
        guard let call = incoming else { return }
        stopRinging()
        WKInterfaceDevice.current().play(.failure)
        relay?(call.id, "decline")
        incoming = nil
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
