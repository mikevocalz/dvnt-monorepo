import SwiftUI

/// DVNT brand on watchOS. True-black canvas (OLED power + contrast), the exact
/// teal→blue and purple ramps from docs/dvnt-design-system.md. No substitutions.
enum DVNT {
    static let canvas = Color.black

    // Teal → blue ramp (exact stops).
    static let teal = [
        Color(hex: 0x0f4961),
        Color(hex: 0x175b7b),
        Color(hex: 0x217098),
        Color(hex: 0x2981af),
        Color(hex: 0x2f8ec1),
        Color(hex: 0x3397ce),
        Color(hex: 0x369cd5),
        Color(hex: 0x379ed8),
    ]

    // Purple ramp (exact stops).
    static let purple = [
        Color(hex: 0x874e9f),
        Color(hex: 0x824a9b),
        Color(hex: 0x743f92),
        Color(hex: 0x5d2d82),
        Color(hex: 0x5b2c81),
    ]

    static let accent = Color(hex: 0x3397ce)

    /// Diagonal brand gradient used on accents and QR-screen chrome.
    static let brandGradient = LinearGradient(
        colors: teal + purple.reversed(),
        startPoint: .topLeading,
        endPoint: .bottomTrailing
    )

    /// Tier accent matching the phone's TIER_ACCENT map.
    static func tierAccent(_ tier: String?) -> Color {
        switch tier {
        case "free": return Color(hex: 0x3FDCFF)
        case "vip": return Color(hex: 0x8A40CF)
        case "table": return Color(hex: 0xFF5BFC)
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
