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

    var body: some View {
        Group {
            if let side = matrix?.size, side > 0, let modules = matrix?.modules {
                Canvas { ctx, canvas in
                    let cell = min(canvas.width, canvas.height) / CGFloat(side)
                    var path = Path()
                    for y in 0..<side {
                        for x in 0..<side where modules[y * side + x] {
                            path.addRect(
                                CGRect(
                                    x: CGFloat(x) * cell,
                                    y: CGFloat(y) * cell,
                                    width: cell,
                                    height: cell
                                )
                            )
                        }
                    }
                    ctx.fill(path, with: .color(.black))
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
        .background(Color.white)            // máx contrast quiet zone
    }
}
