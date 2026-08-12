import SwiftUI

/// The Marquee — the top-level menu, made of Doors instead of a symbol list.
///
/// Most watch apps' root is a `List` of SF Symbols. The design system already
/// owns a better composition for this app: **The Door** — artwork, a steep
/// `ink-deep` scrim, a Grotesk title over it, "never an empty box." So every
/// top-level destination is a full-bleed piece of the night rather than a row
/// with an icon.
///
/// Four moves make it read as designed rather than decorated:
///
///  1. **Art-led pages.** Now = tonight's flyer. Tickets = the held pass's art.
///     Events = what's next. Messages = a mosaic of who wrote. Nothing is empty:
///     `EventArt` falls back to the event's dominant colour, then to the Deviant
///     Gradient — never grey.
///  2. **The gradient as a rail.** A 2pt bar on the trailing edge marks position
///     in the stack. One brand stroke, spent on navigation rather than decoration.
///  3. **Space Mono stubs.** "3 TONIGHT", "2 UNREAD", "DOORS 21:00" — the
///     ticket-stub voice in the chrome is what makes it unmistakably DVNT.
///  4. **A menu that knows what time it is.** Before doors, Now shows a
///     countdown; at doors-open it takes the signal-red LiveDot. The menu
///     changes with the night.
///
/// HORIZONTAL, deliberately — inherited from `RootTabs` and unchanged. The spec
/// proposed `.verticalPage`, but `TicketStackView` already binds the Digital
/// Crown to vertical paging through passes; a vertical root nests
/// vertical-on-vertical and makes the Crown ambiguous (HIG W-DC-03). W-NV-02
/// puts top-level sections on horizontal swipe for exactly this reason.

// MARK: - One Door

/// A single marquee page: art, scrim, eyebrow, title, mono stub.
///
/// The whole page is the tap target — there is no "row" to hit on a 40mm screen.
struct MarqueePage<Destination: View>: View {
    var art: EventArtSource = .none
    let eyebrow: String
    let title: String
    var stub: String?
    var live: Bool = false
    /// Draw the wordmark over the art on this Door. Exactly one page sets it.
    var showsWordmark: Bool = false
    @ViewBuilder let destination: () -> Destination

    var body: some View {
        NavigationStack {
            NavigationLink {
                destination()
            } label: {
                ZStack(alignment: .bottomLeading) {
                    art.view

                    // The Door's scrim: transparent at the middle, near-opaque
                    // at the base, so the type has a black bed to sit on and the
                    // art still reads above it.
                    LinearGradient(
                        colors: [.clear, DVNT.canvas.opacity(0.92)],
                        startPoint: .center,
                        endPoint: .bottom
                    )

                    VStack(alignment: .leading, spacing: DVNT.Space.hair) {
                        HStack(spacing: DVNT.Space.tight) {
                            Text(eyebrow.uppercased())
                                .font(DVNT.TypeScale.stamp(11))
                                .tracking(DVNT.TypeScale.stampTracking)
                                .foregroundStyle(live ? DVNT.signal : DVNT.OnArt.secondary)
                            if live { LiveDot() }
                        }
                        // Guarded like the stub: a Door whose eyebrow and stub
                        // already say everything ("MESSAGES" / "3 UNREAD") has
                        // no title worth inventing, and an empty Text would
                        // still reserve a line of Grotesk over the art.
                        if !title.isEmpty {
                            Text(title)
                                .font(DVNT.TypeScale.title(18))
                                .foregroundStyle(DVNT.OnArt.primary)
                                .lineLimit(2)
                                // On a 162pt SE the same string that fits one
                                // line on a 205pt Ultra wraps to two, and the
                                // card grows to swallow a third of the Door.
                                // Shrink to fit before wrapping. The floor is
                                // 0.85 — below that it stops clearing the 18pt
                                // title minimum the type scale exists to hold.
                                .minimumScaleFactor(0.85)
                        }
                        if let stub, !stub.isEmpty {
                            Text(stub)
                                .font(DVNT.TypeScale.numeral(13))
                                .foregroundStyle(DVNT.accent)
                        }
                    }
                    .padding(DVNT.Space.roomy)
                    // The stub is the last line in the card and the TabView
                    // draws its page dots across the same band, so "2 UNREAD"
                    // was sitting underneath them. Extra bottom padding lifts
                    // the whole block clear of the indicator rather than
                    // shortening the stub or hiding the dots — both of which
                    // cost information the wearer uses.
                    .padding(.bottom, DVNT.Space.roomy)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    // A Door assembles instead of appearing — the same
                    // one-shot fade+rise the event list already uses, so the
                    // two surfaces move the same way. Reduce Motion turns it
                    // off entirely (the modifier handles that), never slows it.
                    .appearStaggered(index: 1)
                    // The single glass surface — chrome floating on artwork.
                    // No-op before watchOS 26; the scrim already covers it.
                    .marqueeChrome()
                }
                // The brand moment, and the only one on this device. It sits on
                // the Door rather than inside the screen behind it because the
                // Door is what a swipe lands on — a wordmark one tap deep is a
                // wordmark nobody sees. Over the art, not over black: the
                // Deviant Gradient behind it is the brand, and the top of a
                // Door was otherwise dead space.
                //
                // Set on the `now` page only. Four Doors each stamped with the
                // same mark spends it four times and lands it none.
                .overlay(alignment: .top) {
                    if showsWordmark {
                        // Nearly full width, centred. `.top` centres it
                        // horizontally; fillWidth makes it scale with the
                        // watch instead of being 38% of an Ultra and 48% of
                        // an SE.
                        DVNTLogoView(fillWidth: true)
                            // ~94% of the Door: 6pt a side lands at 94% on a
                            // 205pt Ultra and 93% on a 162pt SE, close enough
                            // that the mark reads the same on both without a
                            // GeometryReader in an overlay.
                            .padding(.horizontal, 6)
                            // Clear of the clock. watchOS draws the time in the
                            // top-right of every app, and at 12pt the wordmark's
                            // T ran underneath it. This drops the mark below
                            // that band instead of fighting a system element
                            // that cannot be moved.
                            .padding(.top, 36)
                            // Assembles with the Door rather than being
                            // pre-painted on it. Index 0 — the mark lands
                            // first, the title block follows.
                            .appearStaggered(index: 0)
                            // The art is an unknown image, so the mark carries
                            // its own shadow rather than trusting the flyer to
                            // be dark where the glyphs land.
                            .shadow(color: .black.opacity(0.5), radius: 3, y: 1)
                            .accessibilityHidden(true)
                    }
                }
            }
            .buttonStyle(.plain)
            .ignoresSafeArea()
        }
    }
}

/// What fills a Door. Keeps `MarqueePage` from caring whether it is showing one
/// flyer, four avatars, or nothing at all — every case still renders something
/// branded, which is the "never an empty box" rule.
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
        // Four senders landing in sequence reads as the room filling up; four
        // appearing at once reads as a screenshot.
        .appearStaggered(index: i)
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
    let index: Int
    let count: Int

    var body: some View {
        GeometryReader { geo in
            let segment = geo.size.height / CGFloat(max(count, 1))
            Capsule()
                .fill(DVNT.brandGradient)
                .frame(width: 2, height: segment)
                .offset(y: segment * CGFloat(index))
                .animation(DVNT.Motion.enter, value: index)
        }
        .frame(width: 2)
        .padding(.trailing, 2)
        .opacity(0.9)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Liquid Glass

/// The one glass surface, on the navigation layer only.
///
/// watchOS 26 ships Liquid Glass: a translucent material for chrome that floats
/// *above* content and refracts what is behind it. The design system already
/// asks for exactly this on web — "depth = hairlines + the liquid-glass header
/// (saturate(160%) blur(18px), bg ink/72), ONE glass surface, not drop-shadows
/// everywhere." A Door's label block is that surface here: it is chrome sitting
/// on artwork, which is precisely the case the material was designed for.
///
/// AVAILABILITY-GATED RATHER THAN RAISING THE FLOOR. The spec framed this as a
/// choice between bumping deploymentTarget (which drops Series 4/5 and SE 1) or
/// faking it with .ultraThinMaterial. There is a third option that costs
/// nothing: keep deploymentTarget at 10.0 and gate on #available. Modern watches
/// get real Liquid Glass, older ones keep the scrim they already had, and no
/// member loses the app over a material.
///
/// Verified against WatchOS26.4.sdk: `.glassEffect(.regular, in:)` typechecks at
/// -target arm64_32-apple-watchos26.0 and fails at 10.0 with "only available in
/// watchOS 26.0 or newer" — which is what makes the gate necessary and correct.
///
/// NEVER put this on a content row. One strong surface, not many weak ones.
extension View {
    @ViewBuilder func marqueeChrome() -> some View {
        if #available(watchOS 26.0, *) {
            self.glassEffect(
                .regular,
                in: .rect(cornerRadius: DVNT.Radius.card, style: .continuous)
            )
        } else {
            // Pre-26: the Door's own scrim is already doing this job, so add
            // nothing. A white-opacity panel here would be the "many weak
            // surfaces" the design system rules out.
            self
        }
    }
}
