import SwiftUI
import WidgetKit

@available(watchOS 26.0, *)
struct DVNTWidgetPrivacyControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "DVNTWidgetPrivacy", provider: Provider()) { value in
            ControlWidgetToggle("Widget details", isOn: value, action: WatchWidgetPrivacyIntent()) { visible in
                Label(visible ? "Shown" : "Hidden", systemImage: visible ? "eye" : "eye.slash")
            }
        }
        .displayName("Widget details")
        .description("Show or hide event details on your watch widgets.")
    }
    struct Provider: ControlValueProvider {
        var previewValue: Bool { false }
        func currentValue() async throws -> Bool {
            UserDefaults(suiteName: "group.com.dvnt.app.watch")?.bool(forKey: "dvnt.widget.showDetails") == true
        }
    }
}
