import Foundation
import UserNotifications
import ImageIO

final class NotificationService: UNNotificationServiceExtension, URLSessionTaskDelegate, @unchecked Sendable {
    private let lock = NSLock()
    private var completion: ((UNNotificationContent) -> Void)?
    private var content: UNMutableNotificationContent?
    private var task: Task<Void, Never>?
    private var session: URLSession?
    override func didReceive(_ request: UNNotificationRequest, withContentHandler handler: @escaping (UNNotificationContent) -> Void) {
        completion = handler
        content = request.content.mutableCopy() as? UNMutableNotificationContent
        guard let url = NotificationImageSource.url(request.content.userInfo) else { finish(request.content); return }
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 8
        configuration.timeoutIntervalForResource = 12
        configuration.urlCache = nil
        configuration.httpCookieStorage = nil
        configuration.urlCredentialStorage = nil
        let session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
        self.session = session
        task = Task { [weak self] in
            guard let self else { return }
            defer { self.finish(request.content) }
            do {
                let (bytes, response) = try await session.bytes(from: url)
                defer { bytes.task.cancel() }
                guard let http = response as? HTTPURLResponse, http.statusCode == 200,
                      http.url?.host == "dvnt.b-cdn.net", http.url?.scheme == "https",
                      response.expectedContentLength <= 1_048_576,
                      let mime = response.mimeType, ["image/jpeg", "image/png", "image/webp"].contains(mime) else { return }
                var data = Data()
                for try await byte in bytes {
                    if data.count % 8192 == 0 { try Task.checkCancellation() }
                    guard data.count < 1_048_576 else { return }
                    data.append(byte)
                }
                guard let source = CGImageSourceCreateWithData(data as CFData, nil),
                      let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
                      let width = properties[kCGImagePropertyPixelWidth] as? Int,
                      let height = properties[kCGImagePropertyPixelHeight] as? Int,
                      width > 0, height > 0, width <= 2048, height <= 2048 else { return }
                let suffix = mime == "image/png" ? "png" : mime == "image/webp" ? "webp" : "jpg"
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                defer { try? FileManager.default.removeItem(at: directory) }
                let file = directory.appendingPathComponent("image.\(suffix)")
                try data.write(to: file, options: .atomic)
                let attachment = try UNNotificationAttachment(identifier: "dm-image", url: file)
                self.attach(attachment)
            } catch { /* The original private-preview text remains deliverable. */ }
        }
    }
    func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(request.url.map(NotificationImageSource.allowed) == true ? request : nil)
    }
    private func attach(_ attachment: UNNotificationAttachment) {
        lock.lock(); defer { lock.unlock() }
        if completion != nil { content?.attachments = [attachment] }
    }
    private func finish(_ fallback: UNNotificationContent) {
        lock.lock()
        let handler = completion; completion = nil
        let result = content ?? fallback
        lock.unlock()
        handler?(result)
        session?.invalidateAndCancel()
    }
    override func serviceExtensionTimeWillExpire() {
        task?.cancel()
        if let content { finish(content) }
    }
}
