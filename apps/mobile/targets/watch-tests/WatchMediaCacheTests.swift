import Foundation
import CryptoKit
import ImageIO

@main struct WatchMediaCacheTests {
    static func main() async throws {
        let directory = FileManager.default.temporaryDirectory.appendingPathComponent("dvnt-media-\(UUID().uuidString)")
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        defer { try? FileManager.default.removeItem(at: directory) }
        let url = "https://offline.invalid/photo"
        func key(_ account: String) -> String {
            SHA256.hash(data: Data("\(account)|128|\(url)".utf8)).map { String(format: "%02x", $0) }.joined()
        }
        let png = Data(base64Encoded: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aJ1sAAAAASUVORK5CYII=")!
        try png.write(to: directory.appendingPathComponent(key("a")))
        let restored = WatchMediaCache(directory: directory)
        let image = try await restored.image(url: url, accountGen: "a", maximumPixels: 128)
        precondition(image.width == 1 && image.height == 1)
        precondition(!FileManager.default.fileExists(atPath: directory.appendingPathComponent(key("b")).path))
        let secondLaunch = WatchMediaCache(directory: directory)
        let second = try await secondLaunch.image(url: url, accountGen: "a", maximumPixels: 128)
        precondition(second.width == 1)
        await secondLaunch.purge()
        precondition(!FileManager.default.fileExists(atPath: directory.path))
        let bytes = await secondLaunch.cachedByteCount
        precondition(bytes == 0)
        print("WatchMediaCache: offline disk read across launch, account-key isolation and purge passed")
    }
}
