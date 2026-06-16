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
