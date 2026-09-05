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

            ScrollView {
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

                RoundedRectangle(cornerRadius: DVNT.Radius.control)
                    .fill(DVNT.surface)
                    .overlay(RoundedRectangle(cornerRadius: DVNT.Radius.control).strokeBorder(DVNT.hairline, lineWidth: 1))
                    .overlay {
                        if let url = call.callerAvatar, URL(string: url)?.scheme == "https" {
                            EventArt(dominantHex: nil, imageURL: url, cornerRadius: DVNT.Radius.control)
                        } else {
                            Text(call.initial).font(DVNT.TypeScale.title(30)).foregroundColor(.white)
                        }
                    }
                    .clipShape(RoundedRectangle(cornerRadius: DVNT.Radius.control))
            }
            .frame(width: 62, height: 62)
        }
        .accessibilityHidden(true)
    }

    // MARK: - Actions

    /// Visible labels name the phone audio route before the wearer answers.
    private var actions: some View {
        VStack(spacing: DVNT.Space.base) {
            CallButton(symbol: "phone.down.fill", fill: DVNT.signal,
                       label: "Decline", action: onDecline)
            CallButton(symbol: "phone.fill",
                       fill: DVNT.accent,
                       label: call.isVideo ? "Answer as audio on iPhone" : "Answer on iPhone", action: onAccept)
        }
    }

    /// Said plainly, because the alternative is a wearer holding a silent watch
    /// to their ear. Companion mode keeps audio on the iPhone.
    private var handoffNote: some View {
        Label(call.isVideo ? "Answering as audio on iPhone…" : "Connecting on iPhone…", systemImage: "iphone.gen3")
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
            Label(label, systemImage: symbol)
                .font(DVNT.TypeScale.body())
                .foregroundColor(.black)
                .frame(maxWidth: .infinity, minHeight: 44)
                .padding(.horizontal, DVNT.Space.base)
                .background(RoundedRectangle(cornerRadius: DVNT.Radius.control).fill(fill))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}
