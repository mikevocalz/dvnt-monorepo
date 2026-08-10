import SwiftUI

/// Full-screen ringing UI. Covers everything — a call is the one thing on this
/// watch that outranks a ticket.
struct IncomingCallView: View {
    let call: WatchIncomingCall
    let handedOff: Bool
    let onAccept: () -> Void
    let onDecline: () -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @Environment(\.scenePhase) private var scenePhase

    /// Same discipline as `AccessRing`: the pulse is a paused `TimelineView`,
    /// not a `repeatForever`, so a ringing screen that the wearer lowers their
    /// wrist on stops redrawing instead of animating into a dimmed display.
    private var isPulsing: Bool {
        !handedOff && !reduceMotion && !isLuminanceReduced && scenePhase == .active
    }

    var body: some View {
        ZStack {
            DVNT.canvas.ignoresSafeArea()

            VStack(spacing: DVNT.Space.roomy) {
                avatar

                VStack(spacing: DVNT.Space.hair) {
                    Text(call.callerName)
                        .font(DVNT.TypeScale.title(20))
                        .foregroundColor(.white)
                        .lineLimit(1)
                    Text(subtitle)
                        .font(DVNT.TypeScale.caption())
                        .foregroundColor(DVNT.textDim)
                }

                if handedOff {
                    handoffNote
                } else {
                    actions
                }
            }
            .padding(.horizontal, DVNT.Space.roomy)
        }
        .accessibilityElement(children: .contain)
    }

    private var subtitle: String {
        if handedOff { return "Connecting" }
        let kind = call.isVideo ? "video call" : "call"
        return call.isGroup ? "Incoming group \(kind)" : "Incoming \(kind)"
    }

    // MARK: - Avatar

    /// Concentric rings breathing outward from the caller. Three strokes and one
    /// scale — the same shader-free approach as `AccessRing`, for the same
    /// reason: a blur or shadow here is a full-frame offscreen pass per frame,
    /// and this screen can be up for thirty seconds.
    private var avatar: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !isPulsing)) { ctx in
            let t = isPulsing
                ? ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 1.8) / 1.8
                : 0

            ZStack {
                ForEach(0..<3, id: \.self) { i in
                    // Stagger the three rings a third of a cycle apart so they
                    // read as a continuous outward pulse, not a throb.
                    let p = (t + Double(i) / 3).truncatingRemainder(dividingBy: 1)
                    Circle()
                        .stroke(DVNT.accent, lineWidth: 2)
                        .scaleEffect(1 + p * 0.55)
                        .opacity(isPulsing ? (1 - p) * 0.5 : 0)
                }

                Circle()
                    .fill(DVNT.surface)
                    .overlay(Circle().strokeBorder(DVNT.hairline, lineWidth: 1))
                    .overlay(
                        Text(call.initial)
                            .font(.system(size: 30, weight: .semibold))
                            .foregroundColor(.white)
                    )
            }
            .frame(width: 62, height: 62)
        }
        .accessibilityHidden(true)
    }

    // MARK: - Actions

    /// Decline left, accept right, both large. HIG W-NV-05 wants the primary
    /// action one tap away — on a ringing screen both actions are primary, so
    /// neither is buried behind a swipe or a confirm.
    private var actions: some View {
        HStack(spacing: DVNT.Space.loose) {
            CallButton(symbol: "phone.down.fill", fill: DVNT.signal,
                       label: "Decline", action: onDecline)
            CallButton(symbol: call.isVideo ? "video.fill" : "phone.fill",
                       fill: Color(hex: 0x2ECC71),
                       label: "Answer", action: onAccept)
        }
    }

    /// Said plainly, because the alternative is a wearer holding a silent watch
    /// to their ear. The audio is on the phone; watchOS gives no third-party app
    /// a duplex route to the watch speaker and mic.
    private var handoffNote: some View {
        Label("Answered — audio is on your iPhone", systemImage: "iphone.gen3")
            .font(DVNT.TypeScale.caption())
            .foregroundColor(DVNT.textDim)
            .multilineTextAlignment(.center)
    }
}

private struct CallButton: View {
    let symbol: String
    let fill: Color
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: 20, weight: .semibold))
                .foregroundColor(.white)
                .frame(width: 52, height: 52)
                .background(Circle().fill(fill))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}
