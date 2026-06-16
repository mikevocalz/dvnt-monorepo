import SwiftUI
import CoreImage
import CoreImage.CIFilterBuiltins
import WatchKit

/// Renders a `qrToken` as a QR code BYTE-IDENTICAL to the phone: same string,
/// QR symbology, error-correction level "H" (the phone uses H so a wordmark can
/// overlay; we keep H for arm's-length scan robustness on a ~40 mm OLED).
///
/// Nearest-neighbour upscale (no interpolation) keeps module edges crisp so a
/// phone camera locks on the first try.
struct QRCodeView: View {
    let token: String
    var size: CGFloat = 132

    private static let context = CIContext()

    var body: some View {
        Group {
            if let img = Self.generate(token, side: size) {
                Image(uiImage: img)
                    .interpolation(.none)
                    .resizable()
                    .scaledToFit()
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

    static func generate(_ string: String, side: CGFloat, scale: CGFloat = 3) -> UIImage? {
        guard !string.isEmpty else { return nil }
        let filter = CIFilter.qrCodeGenerator()
        filter.message = Data(string.utf8)
        filter.correctionLevel = "H"        // matches the phone's ecl="H"
        guard let output = filter.outputImage else { return nil }

        // Upscale to a crisp pixel grid before rasterising.
        let target = side * (WKScreenScale())
        let scaleX = target / output.extent.width
        let scaleY = target / output.extent.height
        let transformed = output.transformed(by: CGAffineTransform(scaleX: scaleX, y: scaleY))

        guard let cg = context.createCGImage(transformed, from: transformed.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}

private func WKScreenScale() -> CGFloat {
    WKInterfaceDevice.current().screenScale
}
