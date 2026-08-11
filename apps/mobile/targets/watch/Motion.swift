import SwiftUI

/// Shared motion primitives for the watch target.
///
/// Every animation in here encodes state — entrance, liveness, time remaining.
/// None is decoration, because decoration on a wrist costs battery in the one
/// place the wearer cannot plug in.
///
/// House rule, inherited from `AccessRing` and `IncomingCallView`: a repeating
/// animation is a **paused `TimelineView`**, never `repeatForever`. A
/// `repeatForever` keeps ticking when the view scrolls off, when the wrist
/// drops into Always-On, and when the app is backgrounded — none of which you
/// can see in the simulator, all of which drain the battery. The gate is always
/// the same three environment values plus scene phase.

// MARK: - Staggered entrance

extension View {
    /// Fade + rise, delayed by row index, so a list assembles instead of
    /// appearing. One-shot: no timeline, nothing to pause.
    func appearStaggered(index: Int) -> some View {
        modifier(StaggerIn(index: index))
    }
}

private struct StaggerIn: ViewModifier {
    let index: Int

    /// HIG W-AC-04: Reduce Motion means off, not slower. The row still needs to
    /// be *there* — so it starts fully shown and never animates.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var shown = false

    func body(content: Content) -> some View {
        content
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 14)
            .onAppear {
                guard !reduceMotion else { shown = true; return }
                withAnimation(DVNT.Motion.stagger(index)) { shown = true }
            }
    }
}

// MARK: - Liveness

/// A slow breathing dot. Shown only next to a ticket that can actually be
/// presented at a door right now — it means "this is live", so it must never
/// appear next to a used, revoked or expired pass.
struct LiveDot: View {
    var diameter: CGFloat = 6

    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    private var isPulsing: Bool {
        scenePhase == .active && !isLuminanceReduced && !reduceMotion
    }

    var body: some View {
        // 2.2s cycle, matching the "breathe" cadence the design system uses for
        // ambient liveness. Static at full strength when the gate is closed —
        // the dot still reads as present, it just stops costing frames.
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !isPulsing)) { ctx in
            let t = isPulsing
                ? ctx.date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.2) / 2.2
                : 0
            // Triangle wave 0→1→0, so the fade in and out are symmetric.
            let wave = 1 - abs(t * 2 - 1)

            Circle()
                .fill(DVNT.accent)
                .frame(width: diameter, height: diameter)
                .opacity(isPulsing ? 0.35 + wave * 0.65 : 1)
        }
        .frame(width: diameter, height: diameter)
        .accessibilityHidden(true)   // the row's own label already says "valid"
    }
}

// MARK: - Countdown

/// Time until doors, in monospaced digits so the row does not reflow as it
/// ticks. Updates once a minute — deliberately not `Text(_:style: .relative)`,
/// which self-updates every second and keeps redrawing in Always-On.
///
/// HIG W-AO-03: `.everyMinute` is the schedule to use, not
/// `.periodic(from: .now, by: 60)`. `.everyMinute` fires on the wall-clock
/// minute boundary and is the cadence the system expects in Always-On; a
/// `.periodic` anchored at `.now` drifts off the minute the view was created,
/// so the displayed value can be up to 59s stale relative to the clock beside it.
struct DoorsCountdown: View {
    let doorsAt: Date
    var size: CGFloat = 28

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.everyMinute) { ctx in
            let remaining = doorsAt.timeIntervalSince(ctx.date)

            Text(Self.label(remaining))
                .font(DVNT.TypeScale.numeral(size))
                .foregroundStyle(remaining <= 0 ? DVNT.accent : Color.white)
                // Digits roll rather than swap. Suppressed under Reduce Motion.
                .contentTransition(reduceMotion ? .identity : .numericText())
                .animation(reduceMotion ? nil : DVNT.Motion.quick, value: Self.label(remaining))
                .accessibilityLabel(Self.accessibilityLabel(remaining))
        }
    }

    /// Coarse by design: nobody standing outside a venue needs seconds, and a
    /// seconds field is what would force a 1Hz redraw.
    static func label(_ remaining: TimeInterval) -> String {
        guard remaining > 0 else { return "Doors open" }
        let minutes = Int(remaining / 60)
        if minutes < 60 { return "\(minutes)m" }
        let hours = minutes / 60
        if hours < 24 { return "\(hours)h \(minutes % 60)m" }
        return "\(hours / 24)d \(hours % 24)h"
    }

    static func accessibilityLabel(_ remaining: TimeInterval) -> String {
        remaining > 0 ? "Doors in \(label(remaining))" : "Doors are open"
    }
}
