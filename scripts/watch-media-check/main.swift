import Foundation
import CoreGraphics
import ImageIO

/// Synthetic bytes only. URLProtocol intercepts every request; no network or user media.
private final class MediaFixtureProtocol: URLProtocol, @unchecked Sendable {
    private static let lock = NSLock()
    private static var payload = Data()
    private static var active = 0
    private static var peak = 0
    private static var started = 0
    private var completed = false

    static func configure(image: Data) { lock.lock(); payload = image; lock.unlock() }
    static var requestCount: Int { lock.lock(); defer { lock.unlock() }; return started }
    static var peakRequests: Int { lock.lock(); defer { lock.unlock() }; return peak }
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        Self.lock.lock()
        Self.started += 1
        Self.active += 1
        Self.peak = max(Self.peak, Self.active)
        Self.lock.unlock()
        let path = request.url!.path
        DispatchQueue.global().asyncAfter(deadline: .now() + (path == "/slow" ? 0.15 : 0.02)) { [self] in
            Self.lock.lock()
            guard !completed else { Self.lock.unlock(); return }
            let image = Self.payload
            Self.lock.unlock()
            let headers = path == "/header-limit" ? ["Content-Length": "\(WatchMediaCache.transferLimit + 1)"] : [:]
            let response = HTTPURLResponse(url: request.url!, statusCode: path == "/expired" ? 403 : 200,
                httpVersion: "HTTP/1.1", headerFields: headers)!
            client?.urlProtocol(self, didReceive: response, cacheStoragePolicy: .notAllowed)
            let bytes: Data
            switch path {
            case "/body-limit": bytes = Data(repeating: 0, count: WatchMediaCache.transferLimit + 1)
            case "/corrupt": bytes = Data("invalid image".utf8)
            default: bytes = image
            }
            client?.urlProtocol(self, didLoad: bytes)
            finish()
            client?.urlProtocolDidFinishLoading(self)
        }
    }

    override func stopLoading() { finish() }
    private func finish() {
        Self.lock.lock()
        defer { Self.lock.unlock() }
        if !completed { completed = true; Self.active -= 1 }
    }
}

private func fixturePNG() -> Data {
    let context = CGContext(data: nil, width: 4000, height: 4000, bitsPerComponent: 8,
        bytesPerRow: 4000 * 4, space: CGColorSpaceCreateDeviceRGB(),
        bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue)!
    context.setFillColor(CGColor(red: 0.2, green: 0.5, blue: 0.8, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: 4000, height: 4000))
    let result = NSMutableData()
    let destination = CGImageDestinationCreateWithData(result, "public.png" as CFString, 1, nil)!
    CGImageDestinationAddImage(destination, context.makeImage()!, nil)
    precondition(CGImageDestinationFinalize(destination))
    return result as Data
}

private func expectFailure(_ path: String, cache: WatchMediaCache,
                           matches: (WatchMediaCache.Failure) -> Bool) async throws {
    do {
        _ = try await cache.image(url: "https://fixtures.invalid\(path)", accountGen: "account-a", maximumPixels: 512)
        fatalError("Expected rejection for \(path)")
    } catch let failure as WatchMediaCache.Failure {
        precondition(matches(failure), "Wrong failure for \(path)")
    }
}

@main private struct MediaChecks {
    static func main() async throws {
        MediaFixtureProtocol.configure(image: fixturePNG())
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MediaFixtureProtocol.self]
        let cache = WatchMediaCache(configuration: configuration)
        let image = try await cache.image(url: "https://fixtures.invalid/first", accountGen: "account-a", maximumPixels: 4000)
        precondition(image.width == 512 && image.height == 512, "4000px source must downsample before display")
        let afterFirst = MediaFixtureProtocol.requestCount
        _ = try await cache.image(url: "https://fixtures.invalid/first", accountGen: "account-a", maximumPixels: 512)
        precondition(MediaFixtureProtocol.requestCount == afterFirst, "Cache must avoid refetch")
        _ = try await cache.image(url: "https://fixtures.invalid/first", accountGen: "account-b", maximumPixels: 512)
        precondition(MediaFixtureProtocol.requestCount == afterFirst + 1, "Account generations must not share images")
        try await expectFailure("/header-limit", cache: cache) { if case .tooLarge = $0 { return true }; return false }
        try await expectFailure("/body-limit", cache: cache) { if case .tooLarge = $0 { return true }; return false }
        try await expectFailure("/corrupt", cache: cache) { if case .invalidImage = $0 { return true }; return false }
        try await expectFailure("/expired", cache: cache) { if case .unavailable = $0 { return true }; return false }
        do {
            _ = try await cache.image(url: "http://fixtures.invalid/insecure", accountGen: "account-a", maximumPixels: 512)
            fatalError("Plain HTTP must be rejected")
        } catch is WatchMediaCache.Failure {}

        try await withThrowingTaskGroup(of: Void.self) { group in
            for index in 0..<12 {
                group.addTask {
                    _ = try await cache.image(url: "https://fixtures.invalid/image-\(index)", accountGen: "account-a", maximumPixels: 512)
                }
            }
            try await group.waitForAll()
        }
        precondition(MediaFixtureProtocol.peakRequests <= 2, "Transfer concurrency exceeded")
        let retainedBytes = await cache.cachedByteCount
        precondition(retainedBytes > 0 && retainedBytes <= WatchMediaCache.memoryLimit, "Decoded LRU exceeded budget")
        let beforeEviction = MediaFixtureProtocol.requestCount
        _ = try await cache.image(url: "https://fixtures.invalid/first", accountGen: "account-a", maximumPixels: 512)
        precondition(MediaFixtureProtocol.requestCount == beforeEviction + 1, "Oldest image was not evicted")
        let pending = Task { try await cache.image(url: "https://fixtures.invalid/slow", accountGen: "account-a", maximumPixels: 512) }
        try await Task.sleep(nanoseconds: 30_000_000)
        await cache.purge()
        do { _ = try await pending.value; fatalError("Pre-reset transfer must not repopulate cache") }
        catch is CancellationError {}
        let afterPurge = await cache.cachedByteCount
        precondition(afterPurge == 0, "Purge must erase decoded cache")
        print("watch media checks passed: downsample, transfer caps, HTTP rejection, corruption, expiry, LRU, account scope, concurrency and reset")
    }
}
