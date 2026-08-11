import SwiftUI
import WatchKit

/// DVNT brand on watchOS. True-black canvas (OLED power + contrast) and the
/// token table from docs/dvnt-design-system.md §1 — cyan / violet / magenta,
/// signal, gold. These are the phone's literal hexes, not a watch-local remix:
/// a member glancing from wrist to phone must not see two brands.
enum DVNT {
    static let canvas = Color.black

    // MARK: Brand stops (design-system §1)
    static let cyan = Color(hex: 0x3FDCFF)
    static let violet = Color(hex: 0x8A40CF)
    static let magenta = Color(hex: 0xFF5BFC)
    static let signal = Color(hex: 0xFC253A)
    static let gold = Color(hex: 0xF5C518)

    static let hairline = Color.white.opacity(0.10)
    static let surface = Color.white.opacity(0.04)

    /// Text sitting on *artwork* rather than on the canvas. A flyer is an
    /// unknown, often mid-tone image, so the canvas ramp (`textDim` 0.60,
    /// `textFaint` 0.40) goes muddy on top of it even through a scrim. These
    /// run brighter on purpose — same hierarchy, more headroom.
    enum OnArt {
        static let primary = Color.white
        static let secondary = Color.white.opacity(0.82)
        static let tertiary = Color.white.opacity(0.66)
    }
    /// Between `textDim` and full white. Four call sites had invented 0.70 and
    /// 0.75 for the same job; both round here, and a 0.02–0.03 alpha shift on
    /// white is below the perceptual floor of an OLED watch panel.
    static let textBright = Color.white.opacity(0.72)
    static let textDim = Color.white.opacity(0.60)
    /// The missing rung. Six call sites wanted "dimmer than `textDim`, brighter
    /// than `textFaint`" and each invented its own 0.5–0.55, which is precisely
    /// how a palette drifts.
    static let textMuted = Color.white.opacity(0.55)
    static let textFaint = Color.white.opacity(0.40)

    /// Primary accent. Cyan is stop 1 and the design system's "primary accent".
    static let accent = cyan

    /// **The Deviant Gradient** — `linear-gradient(100deg, #3FDCFF 0%, #8A40CF 52%,
    /// #FF5BFC 100%)`. One brand stroke, and the design system spends it on a short
    /// list only (CTA, price chip, the "going" ring, one hairline). On the wrist
    /// that list is exactly one thing: `AccessRing`. Everything else is flat
    /// `surface` + `hairline` — see the "Cut the glow" note in the design system.
    ///
    /// 100° in CSS is measured clockwise from north, so the gradient line runs
    /// left→right with a slight upward tilt: (sin100°, −cos100°).
    static let brandGradient = LinearGradient(
        stops: [
            .init(color: cyan, location: 0.0),
            .init(color: violet, location: 0.52),
            .init(color: magenta, location: 1.0),
        ],
        startPoint: UnitPoint(x: 0.008, y: 0.413),
        endPoint: UnitPoint(x: 0.992, y: 0.587)
    )

    /// The same three stops swept around a circle, for `AccessRing`. Wrapped
    /// back to cyan at the seam so a rotating sweep has no visible hard edge.
    static let brandSweep = AngularGradient(
        stops: [
            .init(color: cyan, location: 0.00),
            .init(color: violet, location: 0.36),
            .init(color: magenta, location: 0.70),
            .init(color: cyan, location: 1.00),
        ],
        center: .center
    )

    /// Tier accent matching the phone's TIER_ACCENT map.
    static func tierAccent(_ tier: String?) -> Color {
        switch tier {
        case "free": return cyan
        case "vip": return violet
        case "table": return magenta
        default: return Color(hex: 0x34A2DF) // ga
        }
    }
}

// MARK: - Type

extension DVNT {
    /// The type system. Two registers, deliberately different jobs.
    ///
    /// STRUCTURAL type — tier, status, "present at door", counts — is condensed
    /// and tracked. That is venue vernacular: laminates, door signage, marquee
    /// boards. It also buys real horizontal room on a 40mm screen, so a label
    /// like "GENERAL ADMISSION" sets on one line instead of truncating.
    ///
    /// CONTENT type — event names, host messages, times — stays default width.
    /// Condensing content hurts legibility at arm's length in the dark, which is
    /// the one condition this app is actually used in.
    /// Sizes obey the watchOS glanceability floor (HIG W-GL-03): body is never
    /// below 16pt, titles never below 18pt. The previous screens set 10–15pt
    /// across the board — 32 of 42 explicit sizes were under the floor, which is
    /// why nothing read at arm's length in a dark room.
    enum TypeScale {
        /// Stamped structural label — tier, status, "PRESENT AT DOOR", the
        /// marquee eyebrows. Uppercase at the call site; pair with
        /// `.tracking(DVNT.TypeScale.stampTracking)`.
        ///
        /// This is Republica Minor, and it is the one place the watch gets its
        /// own voice: a bold ITALIC display face reads as venue signage —
        /// laminates, door boards, a marquee — which is exactly the register
        /// these labels occupy. Titles stay Space Grotesk, because an italic
        /// display face is wrong for content you actually read (event names,
        /// host messages) at arm's length in a dark room.
        ///
        /// NAME WARNING: the PostScript name is `RepublicaMinor-BoldItalic`,
        /// NOT the `Republica-Minor` filename. Font.custom takes the PostScript
        /// name; UIAppFonts takes the filename. Swapping them fails silently to
        /// the system face — verify with the name table, never by eye.
        static func stamp(_ size: CGFloat = 13) -> Font {
            .custom("RepublicaMinor-BoldItalic", size: size)
        }

        /// Screen and row titles. Floor is 18pt.
        static func title(_ size: CGFloat = 18) -> Font {
            .custom("SpaceGrotesk-Bold", size: max(size, 18))
        }

        /// Body copy: host messages, event names on the pass. Floor is 16pt.
        static func body(_ size: CGFloat = 16) -> Font {
            .custom("Inter-Regular", size: max(size, 16))
        }

        /// Secondary metadata — dates, venue, staleness. Deliberately the one
        /// register allowed under the body floor, so use it only for text the
        /// user never has to read to act.
        static func caption(_ size: CGFloat = 14) -> Font {
            .custom("Inter-Regular", size: size)
        }

        /// Tracking for stamped labels. Applied via `.tracking(DVNT.TypeScale.stampTracking)`.
        ///
        /// Raised from 1.4 when `stamp` became Republica Minor. That face is
        /// bold AND italic with tight native sidebearings, so set solid it
        /// closes up into a block at 13pt on a 40mm panel — the slanted stems
        /// of adjacent caps nearly touch. 2.2pt at 13pt is ~0.17em, which is
        /// heavy for a text face but correct for tracked-out signage caps and
        /// is what gives the marquee its air.
        ///
        /// If a label ever needs a much larger size, prefer size * 0.17 over
        /// this constant — tracking should scale with the type, and every
        /// current call site sits in the 11-14pt band this is tuned for.
        static let stampTracking: CGFloat = 2.2

        /// Countdowns and counts. Monospaced digits so a ticking value does not
        /// reflow the row it sits in — pair with `.contentTransition(.numericText())`.
        static func numeral(_ size: CGFloat = 28) -> Font {
            .custom("SpaceMono-Regular", size: size).monospacedDigit()
        }

        /// A numeral that is *signage* rather than content — the door count, a
        /// capacity board. Condensed and heavy for the same reason `stamp` is
        /// (venue vernacular: laminates, door boards), but monospaced so a live
        /// count does not reflow its row as it ticks.
        ///
        /// Split from `numeral` deliberately: a plain `numeral` here would drop
        /// `.width(.condensed)` and quietly restyle the one screen a host stares
        /// at all night.
        static func numeralStamp(_ size: CGFloat = 34) -> Font {
            .custom("SpaceMono-Regular", size: size).monospacedDigit()
        }

        /// SF Symbol sizing. Icons were the one register still set with raw
        /// `.system(size:)` at the call site (13 / 15 / 28 across four files);
        /// these are those three values, named.
        enum Icon {
            static let inline: CGFloat = 13   // trailing metadata glyphs
            static let row: CGFloat = 15      // leading glyph on a list row
            static let control: CGFloat = 20  // glyph inside a tap target
            static let hero: CGFloat = 28     // empty-state / focal
        }
    }

    /// Surface elevations. Three steps and a hairline — the exact opacities
    /// already in use, lifted out of the call sites that repeated them.
    enum Surface {
        static let low = Color.white.opacity(0.04)    // == DVNT.surface
        static let mid = Color.white.opacity(0.06)    // list row fill
        static let high = Color.white.opacity(0.15)   // inactive badge
        static let hairline = Color.white.opacity(0.08)
    }

    /// Corner radii. `14` was hardcoded at five call sites in EventListView alone.
    enum Radius {
        static let card: CGFloat = 14
        static let chip: CGFloat = 10
        static let hero: CGFloat = 20
    }

    /// Motion vocabulary. One set of curves so nothing reads as ad-hoc.
    ///
    /// Nothing here loops. This target's rule (see `AccessRing`) is that a
    /// repeating animation must be driven by a `TimelineView` the view can
    /// pause — `repeatForever` keeps ticking off-screen and in Always-On,
    /// which is a battery bug you cannot see in the simulator.
    enum Motion {
        static let enter = Animation.spring(response: 0.42, dampingFraction: 0.82)
        static let settle = Animation.spring(response: 0.55, dampingFraction: 0.9)
        static let quick = Animation.easeOut(duration: 0.18)

        /// Staggered list entrance, capped so a long list does not crawl in.
        static func stagger(_ i: Int) -> Animation { enter.delay(min(Double(i) * 0.055, 0.4)) }
    }
}

// MARK: - Haptics

extension DVNT {
    /// Haptic vocabulary — the same gesture must always feel the same. Named by
    /// meaning, not by `WKHapticType`, so the mapping is changed in one place.
    enum Haptic {
        /// Crown-driven page change.
        static func page() { WKInterfaceDevice.current().play(.click) }
        /// Entering a destination — the ticket stack, the door.
        static func enter() { WKInterfaceDevice.current().play(.start) }
        /// A ticket just went checked-in during a sync. The physical "you're in".
        static func admit() { WKInterfaceDevice.current().play(.success) }
        /// A pass that cannot be presented was opened.
        static func blocked() { WKInterfaceDevice.current().play(.failure) }
    }

    /// 4-based spacing scale. Every magic number in this target should resolve here.
    enum Space {
        static let hair: CGFloat = 2
        static let tight: CGFloat = 4
        static let snug: CGFloat = 6
        static let base: CGFloat = 8
        static let roomy: CGFloat = 12
        static let loose: CGFloat = 16
    }
}

extension Color {
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xff) / 255,
            green: Double((hex >> 8) & 0xff) / 255,
            blue: Double(hex & 0xff) / 255,
            opacity: 1
        )
    }
}
