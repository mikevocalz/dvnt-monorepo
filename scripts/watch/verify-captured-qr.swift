import Foundation
import Vision
import ImageIO

// Tests the actual native screenshot; fixture QR payload is deliberately not a
// ticket. This is image-decode evidence, not a physical door-scanner acceptance.
let expected = "QA-FIXTURE-NOT-A-TICKET-" + String(repeating: "0", count: 42)
var failed = false
for path in CommandLine.arguments.dropFirst() {
    let url = URL(fileURLWithPath: path)
    guard let source = CGImageSourceCreateWithURL(url as CFURL, nil),
          let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        print("FAIL: unreadable \(path)"); failed = true; continue
    }
    let request = VNDetectBarcodesRequest()
    request.symbologies = [.qr]
    do {
        try VNImageRequestHandler(cgImage: image).perform([request])
        let found = request.results?.contains { $0.payloadStringValue == expected } == true
        print("\(found ? "PASS" : "FAIL"): native fixture QR \(url.lastPathComponent)")
        if !found { failed = true }
    } catch {
        print("FAIL: \(url.lastPathComponent): \(error)"); failed = true
    }
}
exit(failed ? 1 : 0)
