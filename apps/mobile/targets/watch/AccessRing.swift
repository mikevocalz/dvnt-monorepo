import SwiftUI

/// The signature moment of DVNT on the wrist.
///
/// The design system spends the Deviant Gradient on a short list, and on watchOS
/// that list is exactly one thing: this ring. Everything else in the target is
/// flat `surface` + `hairline` ("Cut the glow", docs/dvnt-design-system.md §6).
///
/// **The ring encodes time, never tier.** The arc fills across the last 24 hours
/// before doors, runs full while the door is open, and goes dashed when the pass
/// is dead. Tier only tints it. That split matters for HIG W-AC-01: a member who
/// cannot separate violet from magenta still reads the ring, because the state is
/// carried by *geometry* (partial / full / dashed) and by the label beside it.
///
/// **Shader-free.** The halo is three concentric strokes of the same arc at
/// widening line widths under a single gradient — no `.blur`, no `.shadow`, no
/// `Canvas` per-frame rasterisation. A blur radius on a watch is a full-frame
/// offscreen pass every frame; three strokes are three draw calls that the
/// compositor handles without breaking a sweat on Series 6-class silicon.
///
/// **Nothing animates that a human cannot see.** The sweep is a `TimelineView`
/// whose schedule is `paused` unless the app is foregrounded, the wrist is up,
/// and Reduce Motion is off. `repeatForever` was the obvious alternative and is
/// wrong: SwiftUI keeps those animations resident when the view is off-screen or
/// the wrist is down, which is battery burned with the display dimmed.
struct AccessRing<Content: View>: View {
    let phase: RingPhase
    /// Tier tint. Applied to the countdown label, not to the arc — the arc is
    /// always the brand sweep, so the ring reads as DVNT and not as a tier chip.
    let tint: Color
    var diameter: CGFloat = 156

    @ViewBuilder var content: () -> Content

    /// Wrist down. HIG W-AO-01: shed complexity, and above all stop redrawing.
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    /// HIG W-AC-04: the sweep is decorative. Off means off, not slower.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.scenePhase) private var scenePhase

    private var isAnimating: Bool {
        phase.animates
            && scenePhase == .active
            && !isLuminanceReduced
            && !reduceMotion
    }

    var body: some View {
        ZStack {
            track
            arc
            content()
        }
        .frame(width: diameter, height: diameter)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(phase.accessibilityLabel)
    }

    // MARK: - Layers

    /// Always drawn, at full circumference. It is the thing the arc is measured
    /// against — without it a 20%-full ring is just an arbitrary stroke.
    private var track: some View {
        Circle()
            .strokeBorder(
                DVNT.hairline,
                style: StrokeStyle(
                    lineWidth: 3,
                    dash: phase.isBlocked ? [3, 5] : []
                )
            )
            .padding(halo)
    }

    @ViewBuilder private var arc: some View {
        if phase.isBlocked {
            EmptyView() // dashed track alone. A dead pass gets no brand stroke.
        } else {
            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: !isAnimating)) { ctx in
                let rotation = isAnimating ? sweepAngle(at: ctx.date) : 0

                ZStack {
                    DVNT.brandSweep
                        .rotationEffect(.degrees(rotation))
                        .mask(haloMask)

                    if let head = phase.fraction, head > 0.02, head < 0.995 {
                        headCap(at: head)
                    }
                }
            }
            .padding(halo)
        }
    }

    /// Three coaxial strokes: a wide faint one, a mid one, and the crisp arc.
    /// Stacked alphas give a falloff that reads as a glow at 326 ppi while
    /// costing three vector strokes instead of a blur pass.
    private var haloMask: some View {
        let shape = Circle()
            .trim(from: 0, to: phase.fraction ?? 1)
            .rotation(.degrees(-90))

        return ZStack {
            shape.stroke(style: StrokeStyle(lineWidth: 13, lineCap: .round))
                .opacity(0.10)
            shape.stroke(style: StrokeStyle(lineWidth: 8, lineCap: .round))
                .opacity(0.22)
            shape.stroke(style: StrokeStyle(lineWidth: 4, lineCap: .round))
        }
    }

    /// A bright bead riding the leading edge of a partial arc, so "how far along"
    /// is legible in the half-second a glance actually lasts.
    private func headCap(at fraction: Double) -> some View {
        Circle()
            .fill(.white)
            .frame(width: 5, height: 5)
            .offset(y: -(diameter - halo * 2) / 2)
            .rotationEffect(.degrees(fraction * 360))
    }

    /// Room for the widest halo stroke so it is not clipped by the frame.
    private var halo: CGFloat { 7 }

    private func sweepAngle(at date: Date) -> Double {
        let t = date.timeIntervalSinceReferenceDate
        return (t.truncatingRemainder(dividingBy: sweepPeriod) / sweepPeriod) * 360
    }
}

/// Seconds for the gradient to travel once around. Slow enough to read as a
/// material catching light rather than a spinner — this is not a progress
/// indicator and must never be mistaken for one. (File-scope because a generic
/// type cannot hold a static stored property.)
private let sweepPeriod: Double = 7.5
