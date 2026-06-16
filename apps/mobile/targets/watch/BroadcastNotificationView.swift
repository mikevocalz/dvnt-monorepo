import SwiftUI
import UserNotifications
import WatchKit

/// Custom long-look for a DVNT host broadcast — the difference between an OS
/// toast and a designed moment. Hierarchy: the host's message is the hero
/// (large, high-contrast on true-black), event/host secondary, an intent glyph
/// for context. The text is rendered VERBATIM; intent only styles the chrome.
///
/// ── Activation note ───────────────────────────────────────────────────────
/// watchOS selects this interface by matching the notification's category
/// identifier to `BroadcastNotification.category` ("dvnt_broadcast", wired in
/// the `WKNotificationScene` in DVNTWatchApp). The `event-broadcast-message`
/// edge function now stamps `categoryId: "dvnt_broadcast"` (→ APNs aps.category)
/// + `data.entityTitle` on every push, so this long-look is selected once that
/// function is deployed. Android / older iOS ignore the unknown category.
enum BroadcastNotification {
    static let category = "dvnt_broadcast"
}

/// Observable model the hosting controller fills from the incoming notification.
final class BroadcastNotificationModel: ObservableObject {
    @Published var heading: String = "DVNT"
    @Published var message: String = ""
    @Published var intent: BroadcastIntent = .general
}

struct BroadcastNotificationView: View {
    @ObservedObject var model: BroadcastNotificationModel

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 6) {
                    Image(systemName: model.intent.glyph)
                        .font(.system(size: 16))
                        .foregroundStyle(model.intent.accent)
                    Text(model.heading)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white.opacity(0.75))
                        .lineLimit(2)
                }

                // The hero — verbatim, never truncated to fit chrome.
                Text(model.message)
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundColor(.white)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
            .padding(.vertical, 6)
        }
        .background(DVNT.canvas.ignoresSafeArea())
    }
}

/// Hosting controller: maps the push content → model, derives intent from the
/// body (styling only), and fires one deliberate haptic on arrival.
final class BroadcastNotificationController: WKUserNotificationHostingController<BroadcastNotificationView> {
    let model = BroadcastNotificationModel()

    override var body: BroadcastNotificationView {
        BroadcastNotificationView(model: model)
    }

    override func didReceive(_ notification: UNNotification) {
        let content = notification.request.content
        let info = content.userInfo

        // Prefer an explicit event title from the payload; fall back to the
        // notification title (the server sets title := event title by default).
        let heading = (info["entityTitle"] as? String)
            ?? (content.title.isEmpty ? "DVNT" : content.title)
        let message = content.body
        let intent = BroadcastIntent.infer(from: message)

        model.heading = heading
        model.message = message
        model.intent = intent

        WKInterfaceDevice.current().play(intent.haptic)
    }
}
