import SwiftUI

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
    static let textDim = Color.white.opacity(0.60)
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
        /// Stamped structural label — tier, status, "PRESENT AT DOOR".
        /// Uppercase at the call site; tracking is baked in. Condensed + heavy at
        /// 13pt reads as signage and stays legible; it is a label, not body copy.
        static func stamp(_ size: CGFloat = 13) -> Font {
            .system(size: size, weight: .heavy).width(.condensed)
        }

        /// Screen and row titles. Floor is 18pt.
        static func title(_ size: CGFloat = 18) -> Font {
            .system(size: max(size, 18), weight: .semibold)
        }

        /// Body copy: host messages, event names on the pass. Floor is 16pt.
        static func body(_ size: CGFloat = 16) -> Font {
            .system(size: max(size, 16), weight: .regular)
        }

        /// Secondary metadata — dates, venue, staleness. Deliberately the one
        /// register allowed under the body floor, so use it only for text the
        /// user never has to read to act.
        static func caption(_ size: CGFloat = 14) -> Font {
            .system(size: size, weight: .regular)
        }

        /// Tracking for stamped labels. Applied via `.tracking(DVNT.TypeScale.stampTracking)`.
        static let stampTracking: CGFloat = 1.4
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
