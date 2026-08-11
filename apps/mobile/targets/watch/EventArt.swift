import SwiftUI

/// Event artwork for the wrist — the one place this target decides what a card
/// looks like behind its text.
///
/// THE RULE: this view is **finished before any network happens**. The event's
/// `dominantHex` paints instantly, underneath, and everything else is drawn on
/// top of it. There is therefore no loading state to design, because there is
/// no moment where the card is unresolved:
///
///   1. `dominantHex` fill — synchronous, offline, always. The card is done.
///   2. `imageURL` — a watch-sized rendition, faded in over the fill if and
///      when it arrives. Failure and timeout are indistinguishable from step 1.
///   3. no hex either → flat `DVNT.Surface.mid` + hairline, the same surface
///      every other inert panel in this target uses.
///
/// Why the hex and not just `AsyncImage`: a paired-but-unreachable watch has no
/// network path of its own, and `AsyncImage` writes nothing into the App Group
/// `TicketStore` persists into — so nothing it fetched survives a relaunch. The
/// pixels cannot ride the wire either; the single WCSession applicationContext
/// slot is size-capped and shared (see `WatchTicket.qrMatrix`). Seven bytes of
/// hex always fit. The hex is the guarantee; the art is the upgrade.
///
/// Deliberately NOT the brand gradient. `Theme.swift` spends the Deviant
/// Gradient on exactly one element on this device — `AccessRing` — and a
/// gradient behind every row would both spend the brand stroke into nothing and
/// light thousands of extra OLED subpixels on a battery the wearer cannot plug in.
struct EventArt: View {
    /// `#rrggbb` (or `#rgb`) from the phone. nil → step 3.
    let dominantHex: String?
    /// Watch-sized rendition. nil, unreachable, or slow → step 1 stands.
    let imageURL: String?
    /// Match the surface it sits in — a row is `.card`, a hero is `.hero`.
    var cornerRadius: CGFloat = DVNT.Radius.card

    /// HIG W-AO-01 / W-AO-03: in Always-On the wrist is down. Kicking off an
    /// image fetch + decode for a screen nobody is looking at is a battery cost
    /// with no viewer, so the URL is simply not handed to `AsyncImage` — the
    /// hex fill is what the dimmed state shows, and it is already correct.
    /// The load starts on its own when the wrist comes back up and this
    /// re-evaluates with a non-nil URL.
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced

    /// HIG W-AC-04: Reduce Motion means no cross-fade, not a slower one.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private var fill: Color { Color(dvntHex: dominantHex) ?? DVNT.Surface.mid }

    private var remoteURL: URL? {
        guard !isLuminanceReduced, let raw = imageURL?.trimmingCharacters(in: .whitespacesAndNewlines),
              !raw.isEmpty
        else { return nil }
        return URL(string: raw)
    }

    var body: some View {
        ZStack {
            // Step 1 / 3. Always present, always beneath, so the image has
            // nothing to flash against when it resolves.
            fill

            if let url = remoteURL {
                AsyncImage(
                    url: url,
                    transaction: Transaction(animation: reduceMotion ? nil : DVNT.Motion.enter)
                ) { phase in
                    if case .success(let image) = phase {
                        image
                            .resizable()
                            .scaledToFill()
                            .transition(.opacity)
                    }
                    // `.empty` and `.failure` draw NOTHING on purpose. No
                    // spinner, no grey placeholder, no broken-image glyph —
                    // the fill underneath is the finished card, and covering
                    // it with a progress state would replace a good answer
                    // with a worse one.
                }
            }
        }
        .clipShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
        .overlay(
            // The same hairline every other surface in this target carries, so
            // a dark flyer still has an edge against the true-black canvas.
            RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                .strokeBorder(DVNT.Surface.hairline, lineWidth: 1)
        )
        // HIG W-AC-02: decorative. The row's own text already names the event,
        // and a second "image" stop would only slow VoiceOver down.
        .accessibilityHidden(true)
    }
}

extension EventArt {
    /// Convenience for the list/hero surfaces, which hold an `EventGroup`.
    init(group: EventGroup, cornerRadius: CGFloat = DVNT.Radius.card) {
        self.init(
            dominantHex: group.dominantHex,
            imageURL: group.imageURL,
            cornerRadius: cornerRadius
        )
    }
}

extension Color {
    /// `#rrggbb` / `rrggbb` / `#rgb` → `Color`, else nil.
    ///
    /// Labelled `dvntHex` rather than overloading `Theme.swift`'s
    /// `Color(hex: UInt32)`: the two take different things, and a same-labelled
    /// pair invites `Color(hex: "#fff")` compiling into the wrong initializer
    /// somewhere down the line.
    ///
    /// Fails closed. A malformed value from the wire yields nil so the caller
    /// falls through to its own surface, rather than a black-on-black card that
    /// looks exactly like the bug this whole field exists to fix.
    init?(dvntHex: String?) {
        guard var s = dvntHex?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !s.isEmpty
        else { return nil }
        if s.hasPrefix("#") { s.removeFirst() }

        if s.count == 3 {
            s = s.map { "\($0)\($0)" }.joined()
        }
        guard s.count == 6, let value = UInt32(s, radix: 16) else { return nil }

        self.init(hex: value)
    }
}
