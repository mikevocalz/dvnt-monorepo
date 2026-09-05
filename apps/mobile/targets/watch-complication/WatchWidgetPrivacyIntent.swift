import AppIntents
import WidgetKit
import Foundation

// Mirrored in app and widget targets so either execution host can resolve the intent.
@available(watchOS 26.0, *)
struct WatchWidgetPrivacyIntent: SetValueIntent {
    static var title: LocalizedStringResource = "Show watch widget details"
    @Parameter(title: "Show details") var value: Bool
    func perform() async throws -> some IntentResult {
        UserDefaults(suiteName: "group.com.dvnt.app.watch")?.set(value, forKey: "dvnt.widget.showDetails")
        WidgetCenter.shared.reloadAllTimelines()
        WidgetCenter.shared.invalidateRelevance(ofKind: "DVNTRelevantEvent")
        ControlCenter.shared.reloadControls(ofKind: "DVNTWidgetPrivacy")
        return .result()
    }
}
