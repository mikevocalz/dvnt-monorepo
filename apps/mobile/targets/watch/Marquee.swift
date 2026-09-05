import SwiftUI

/// PLATFORM BEHAVIOR: the Door is the first item in its page's native scroll.
/// NOT in this view: navigation or Crown ownership.
/// STOP-THE-LINE CHECKS: keep artwork bounded; do not restore a gateway link.
struct DoorHeader: View {
    var art: EventArtSource = .none
    let title: String
    var stub: String?
    var showsWordmark = false
    let minimumHeight: CGFloat

    private var expandedCapture: Bool {
        #if DEBUG
        ProcessInfo.processInfo.arguments.contains("--watch-qa-expanded-door")
        #else
        false
        #endif
    }

    private var contentMinimumHeight: CGFloat {
        if expandedCapture { return minimumHeight }
        // Keep identity on the first scroll row while exposing the first action
        // sooner on 40/41 mm. Multiline type can still grow this minimum.
        return min(minimumHeight, 58)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: DVNT.Space.tight) {
            if showsWordmark {
                DVNTLogoView(height: 28)
            } else {
                Text(title)
                    .font(DVNT.TypeScale.title())
                    .foregroundStyle(DVNT.OnArt.primary)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityAddTraits(.isHeader)
            }
            if let stub, !stub.isEmpty {
                Text(stub)
                    .font(DVNT.TypeScale.numeral(13))
                    .foregroundStyle(DVNT.OnArt.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, DVNT.Space.base)
        .padding(.vertical, expandedCapture ? DVNT.Space.base : DVNT.Space.snug)
        .frame(maxWidth: .infinity, minHeight: contentMinimumHeight, alignment: .bottomLeading)
        .background {
            ZStack {
                art.view
                LinearGradient(
                    colors: [.black.opacity(0.25), DVNT.canvas.opacity(0.92)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            }
            .accessibilityHidden(true)
        }
        .clipShape(RoundedRectangle(cornerRadius: DVNT.Radius.card, style: .continuous))
        .listRowInsets(EdgeInsets())
        .listRowBackground(Color.clear)
    }
}

enum EventArtSource {
    case event(imageURL: String?, dominantHex: String?)
    case mosaic([String])
    case none

    @ViewBuilder var view: some View {
        switch self {
        case let .event(imageURL, dominantHex):
            EventArt(dominantHex: dominantHex, imageURL: imageURL, cornerRadius: 0)
        case let .mosaic(urls):
            AvatarMosaic(urls: urls)
        case .none:
            DVNT.brandGradient.opacity(0.45)
        }
    }
}

// MARK: - Avatar mosaic

/// Messages has no single flyer, so it shows who wrote: a 2x2 of recent senders.
/// Rounded SQUARES, never circles — the design system is explicit about that,
/// and it is what keeps the mosaic reading as one surface rather than four dots.
/// Empty slots take the gradient so a one-message mosaic is still a composition.
struct AvatarMosaic: View {
    let urls: [String]

    /// 4, not 2: at a 2pt gap the corner radius has nowhere to show and the
    /// four tiles read as one cut-up photo rather than four squares.
    private static let gap: CGFloat = 4

    /// Measured halves, not a grid.
    ///
    /// This was a `LazyVGrid`, and with a non-empty `urls` it took the whole
    /// Door down — art, scrim and title card — leaving a transparent page. A
    /// lazy grid asks its content for an intrinsic size; `EventArt` has none (a
    /// gradient and an `AsyncImage` both size to their parent), so the grid
    /// resolved to nothing and the ZStack collapsed with it. It never showed up
    /// on a wrist because the mosaic has always been empty there, and the
    /// empty-slot gradient happens to survive that same layout pass.
    ///
    /// Replacing it with stacks alone was not enough either: tiles asking for
    /// `maxHeight: .infinity` inflate the ZStack and push the title card out of
    /// the Door. Reading the proposed size and handing each tile a hard
    /// half-width/half-height is what keeps the mosaic inside its bounds AND
    /// leaves the card where it belongs.
    var body: some View {
        GeometryReader { geo in
            let w = (geo.size.width - Self.gap) / 2
            let h = (geo.size.height - Self.gap) / 2
            VStack(spacing: Self.gap) {
                HStack(spacing: Self.gap) { tile(0, w, h); tile(1, w, h) }
                HStack(spacing: Self.gap) { tile(2, w, h); tile(3, w, h) }
            }
        }
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private func tile(_ i: Int, _ w: CGFloat, _ h: CGFloat) -> some View {
        Group {
            if i < urls.count {
                // Chip radius, not 0. EventArt draws its hairline as a
                // strokeBorder at whatever radius it is given, so a 0 here put
                // a square stroke on top of a tile the outer clip had already
                // rounded — the corners read sharp even though the image was
                // clipped. Rounded SQUARES, never circles: the design system is
                // explicit, and it is what keeps the mosaic reading as one
                // surface rather than four dots.
                EventArt(
                    dominantHex: nil,
                    imageURL: urls[i],
                    cornerRadius: DVNT.Radius.control
                )
            } else {
                // Never grey — a one-sender mosaic is still a composition.
                DVNT.brandGradient.opacity(0.35)
            }
        }
        .frame(width: max(w, 0), height: max(h, 0))
        .clipShape(
            RoundedRectangle(cornerRadius: DVNT.Radius.control, style: .continuous)
        )
    }
}

// MARK: - The rail

/// Position in the stack, drawn as the one brand stroke.
///
/// This replaces a page-dot row. Dots tell you how many pages there are; the
/// rail tells you where you are in the night, and it is the only place the
/// gradient appears outside `AccessRing`.
struct GradientRail: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.isLuminanceReduced) private var wristDown
    let index: Int
    let count: Int

    var body: some View {
        GeometryReader { geo in
            let segment = geo.size.height / CGFloat(max(count, 1))
            Capsule()
                .fill(DVNT.brandGradient)
                .frame(width: 2, height: segment)
                .offset(y: segment * CGFloat(index))
                .animation(reduceMotion || wristDown ? nil : DVNT.Motion.enter, value: index)
        }
        .frame(width: 2)
        .padding(.trailing, 2)
        .opacity(0.9)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}
