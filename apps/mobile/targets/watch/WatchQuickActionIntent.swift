import AppIntents
import Foundation

/// Shared by the watch app and its extension. A control opens the watch app;
/// the app owns live transport and presents the authoritative result.
@available(watchOS 26.0, *)
enum WatchQuickAction: String, AppEnum {
    case ticket, presence, mute
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Watch action")
    static var caseDisplayRepresentations: [WatchQuickAction: DisplayRepresentation] = [
        .ticket: "Show ticket", .presence: "I’m here", .mute: "Mute phone call"
    ]
}
@available(watchOS 26.0, *)
struct WatchQuickActionIntent: AppIntent {
    static var title: LocalizedStringResource = "DVNT watch action"
    static var openAppWhenRun = true
    @Parameter(title: "Action") var action: WatchQuickAction
    init() {}
    init(_ action: WatchQuickAction) { self.action = action }
    func perform() async throws -> some IntentResult {
        guard let defaults = UserDefaults(suiteName: "group.com.dvnt.app.watch"),
              let data = defaults.data(forKey: "dvnt.watch.session.v2"),
              let session = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              session["pendingReset"] as? Bool != true,
              let generation = session["accountGen"] as? String, !generation.isEmpty else { throw QuickActionFailure.unavailable }
        let request: [String: Any] = ["action": action.rawValue, "accountGen": generation,
            "issuedAt": Date().timeIntervalSince1970, "id": UUID().uuidString]
        defaults.set(try JSONSerialization.data(withJSONObject: request), forKey: "dvnt.watch.quickAction")
        NotificationCenter.default.post(name: Notification.Name("DVNTWatchQuickAction"), object: nil)
        return .result()
    }
}
private enum QuickActionFailure: LocalizedError {
    case unavailable
    var errorDescription: String? { "Open DVNT on your watch and sync with your phone first." }
}
