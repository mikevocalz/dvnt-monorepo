import Foundation
import ImageIO
import CryptoKit

/// PLATFORM BEHAVIOR: HTTPS image bytes and ImageIO decoding stay on this actor.
/// NOT in this cache: credentials, persistent images, URL refresh or original-size decoding.
/// STOP-THE-LINE CHECKS: generation keys, byte/pixel limits and cancellation must survive refactors.
actor WatchMediaCache {
    static let shared = WatchMediaCache()
    static let memoryLimit = 8 * 1024 * 1024
    static let transferLimit = 2 * 1024 * 1024
    static let maximumConcurrentTransfers = 2

    enum Failure: LocalizedError {
        case unavailable, tooLarge, invalidImage
        var errorDescription: String? {
            switch self {
            case .unavailable: return "Image unavailable. Refresh the conversation."
            case .tooLarge: return "Image too large for the watch. Open it on iPhone."
            case .invalidImage: return "This image could not be opened."
            }
        }
    }

    private struct Entry {
        let image: CGImage
        let cost: Int
        var accessed: UInt64
    }

    private let session: URLSession
    private var entries: [String: Entry] = [:]
    private var memoryUsed = 0
    private var access: UInt64 = 0
    private var revision: UInt64 = 0
    private var active = 0
    private var waiting: [CheckedContinuation<Void, Never>] = []
    private var transfers: [UUID: URLSessionDataTask] = [:]

    init(configuration: URLSessionConfiguration = .ephemeral) {
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.httpMaximumConnectionsPerHost = Self.maximumConcurrentTransfers
        configuration.timeoutIntervalForRequest = 20
        configuration.timeoutIntervalForResource = 30
        session = URLSession(configuration: configuration)
    }

    func image(url rawURL: String?, accountGen: String, maximumPixels: Int) async throws -> CGImage {
        guard !accountGen.isEmpty, let rawURL, let url = URL(string: rawURL),
              url.scheme?.lowercased() == "https", url.host != nil,
              url.user == nil, url.password == nil else { throw Failure.unavailable }
        let pixels = min(max(maximumPixels, 1), 512)
        let key = SHA256.hash(data: Data("\(accountGen)|\(pixels)|\(rawURL)".utf8))
            .map { String(format: "%02x", $0) }.joined()
        if let cached = cached(key) { return cached }
        let requestedRevision = revision
        await acquire()
        defer { release() }
        try Task.checkCancellation()
        guard requestedRevision == revision else { throw CancellationError() }
        if let cached = cached(key) { return cached }

        var request = URLRequest(url: url)
        request.setValue("image/*", forHTTPHeaderField: "Accept")
        let (bytes, response) = try await session.bytes(for: request)
        let id = UUID()
        transfers[id] = bytes.task
        defer { bytes.task.cancel(); transfers[id] = nil }
        guard requestedRevision == revision else { throw CancellationError() }
        guard let response = response as? HTTPURLResponse,
              (200..<300).contains(response.statusCode) else { throw Failure.unavailable }
        guard response.expectedContentLength <= Self.transferLimit else { throw Failure.tooLarge }
        var data = Data()
        for try await byte in bytes {
            if data.count % 65536 == 0 { try Task.checkCancellation() }
            guard data.count < Self.transferLimit else { throw Failure.tooLarge }
            data.append(byte)
        }
        try Task.checkCancellation()
        guard requestedRevision == revision else { throw CancellationError() }
        let image = try Self.decode(data, maximumPixels: pixels)
        insert(image, key: key)
        return image
    }

    func purge() {
        revision &+= 1
        entries.removeAll()
        memoryUsed = 0
        transfers.values.forEach { $0.cancel() }
        transfers.removeAll()
    }

    var cachedByteCount: Int { memoryUsed }

    private func cached(_ key: String) -> CGImage? {
        guard var entry = entries[key] else { return nil }
        access &+= 1
        entry.accessed = access
        entries[key] = entry
        return entry.image
    }

    private func insert(_ image: CGImage, key: String) {
        let cost = image.bytesPerRow * image.height
        guard cost <= Self.memoryLimit else { return }
        if let previous = entries.removeValue(forKey: key) { memoryUsed -= previous.cost }
        while memoryUsed + cost > Self.memoryLimit,
              let oldest = entries.min(by: { $0.value.accessed < $1.value.accessed }) {
            memoryUsed -= oldest.value.cost
            entries.removeValue(forKey: oldest.key)
        }
        access &+= 1
        entries[key] = Entry(image: image, cost: cost, accessed: access)
        memoryUsed += cost
    }

    private func acquire() async {
        if active < Self.maximumConcurrentTransfers { active += 1; return }
        await withCheckedContinuation { waiting.append($0) }
    }

    private func release() {
        if waiting.isEmpty { active -= 1 } else { waiting.removeFirst().resume() }
    }

    private static func decode(_ data: Data, maximumPixels: Int) throws -> CGImage {
        let options = [kCGImageSourceShouldCache: false] as CFDictionary
        guard let source = CGImageSourceCreateWithData(data as CFData, options),
              let image = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceShouldCacheImmediately: true,
                kCGImageSourceThumbnailMaxPixelSize: maximumPixels
              ] as CFDictionary) else { throw Failure.invalidImage }
        return image
    }
}
