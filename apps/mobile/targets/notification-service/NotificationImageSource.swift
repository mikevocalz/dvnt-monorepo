import Foundation

/// Expo serializes richContent into body._richContent in its APNs payload.
enum NotificationImageSource {
    static func url(_ userInfo: [AnyHashable: Any]) -> URL? {
        let body = userInfo["body"] as? [String: Any]
        let rich = body?["_richContent"] as? [String: Any]
        guard let raw = rich?["image"] as? String, let url = URL(string: raw), allowed(url) else { return nil }
        return url
    }
    static func allowed(_ url: URL) -> Bool {
        url.scheme == "https" && url.host == "dvnt.b-cdn.net" && url.user == nil && url.password == nil && url.port == nil
    }
}
