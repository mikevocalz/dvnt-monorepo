import Foundation
@main struct NotificationImageSourceTests {
    static func main() {
        let raw = "https://dvnt.b-cdn.net/message.jpg?width=256"
        precondition(NotificationImageSource.url(["body": ["_richContent": ["image": raw]]])?.absoluteString == raw)
        precondition(NotificationImageSource.url(["richContent": ["image": raw]]) == nil)
        for raw in ["http://dvnt.b-cdn.net/i.jpg", "https://dvnt.b-cdn.net.evil.test/i.jpg", "https://u:p@dvnt.b-cdn.net/i.jpg", "https://dvnt.b-cdn.net:444/i.jpg", "file:///tmp/image.jpg"] {
            precondition(!NotificationImageSource.allowed(URL(string: raw)!))
        }
        print("NotificationImageSourceTests passed")
    }
}
