import SwiftUI

/// Draws the QR module grid the phone shipped inside the payload.
///
/// watchOS has no Core Image — `CIFilter.qrCodeGenerator()` is iOS-only — so the
/// watch stays a pure presenter here too: the phone encodes `qrToken` at
/// error-correction level "H" (the level it renders itself, so a wordmark can
/// overlay) and hands over the finished module matrix. Painting rects instead of
/// upscaling a bitmap keeps module edges exact at any size, so a phone camera
/// locks on the first try.
struct QRCodeView: View {
    let matrix: WatchQRMatrix?
    var size: CGFloat = 132

    /// Wrist-down (Always On). The code is a credential: watchOS HIG W-AO-02
    /// requires sensitive content to be redacted in the dimmed state, and a
    /// static high-contrast QR left lit is also the worst case for OLED
    /// burn-in. Wrist down shows the mark instead — raise to present.
    @Environment(\.isLuminanceReduced) private var isLuminanceReduced
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        Group {
            if isLuminanceReduced {
                dormant
            } else if let side = matrix?.size, side > 0, let modules = matrix?.modules {
                Canvas { ctx, canvas in
                    // Four modules of pure white on every edge, independent of
                    // the outer card's decorative padding. Align module edges to
                    // physical pixels so small-watch scaling stays crisp.
                    let quietModules = 4
                    let scale = max(displayScale, 1)
                    let cell = floor(min(canvas.width, canvas.height) * scale / CGFloat(side + quietModules * 2)) / scale
                    guard cell > 0 else { return }
                    let originX = floor((canvas.width - CGFloat(side) * cell) * scale / 2) / scale
                    let originY = floor((canvas.height - CGFloat(side) * cell) * scale / 2) / scale
                    var path = Path()
                    for y in 0..<side {
                        for x in 0..<side where modules[y * side + x] {
                            path.addRect(
                                CGRect(
                                    x: originX + CGFloat(x) * cell,
                                    y: originY + CGFloat(y) * cell,
                                    width: cell,
                                    height: cell
                                )
                            )
                        }
                    }
                    ctx.fill(path, with: .color(.black), style: FillStyle(antialiased: false))
                }
            } else {
                // Degenerate fallback — never blank, so the door staff knows to retry.
                ZStack {
                    Color.white
                    Image(systemName: "qrcode")
                        .resizable().scaledToFit().padding(24)
                        .foregroundColor(.black)
                }
            }
        }
        .frame(width: size, height: size)
        // The quiet zone is the scan surface, so it stays pure white while the
        // code is presented — but true black when dormant, so a lowered wrist
        // is not a lit white rectangle in a dark room.
        .background(isLuminanceReduced ? Color.black : Color.white)
        .accessibilityElement()
        .accessibilityLabel(isLuminanceReduced
            ? "Ticket code hidden. Raise your wrist to present it."
            : "Ticket QR code. Show this to door staff.")
    }

    /// Wrist-down state: the mark, and one instruction. No code, no animation,
    /// nothing that updates — HIG W-AO-01 asks for reduced complexity, and
    /// there is nothing here worth a redraw.
    private var dormant: some View {
        VStack(spacing: DVNT.Space.snug) {
            Image(systemName: "qrcode")
                .font(.system(size: DVNT.TypeScale.Icon.hero, weight: .light))
                .foregroundColor(DVNT.accent)
            Text("RAISE TO PRESENT")
                .font(DVNT.TypeScale.stamp())
                .tracking(DVNT.TypeScale.stampTracking)
                .foregroundColor(DVNT.textMuted)
        }
    }
}
