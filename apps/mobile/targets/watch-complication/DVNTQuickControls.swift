import SwiftUI
import WidgetKit

@available(watchOS 26.0, *)
struct DVNTShowTicketControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "DVNTShowTicket") {
            ControlWidgetButton(action: WatchQuickActionIntent(.ticket)) { Label("Show ticket", systemImage: "qrcode") }
        }.displayName("Show ticket").description("Open your current pass on this watch.")
    }
}
@available(watchOS 26.0, *)
struct DVNTPresenceControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "DVNTPresence") {
            ControlWidgetButton(action: WatchQuickActionIntent(.presence)) { Label("I’m here", systemImage: "hand.wave") }
        }.displayName("I’m here").description("Share your arrival status with the event host. No location is sent; this does not check you in.")
    }
}
@available(watchOS 26.0, *)
struct DVNTMuteCallControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "DVNTMuteCall") {
            ControlWidgetButton(action: WatchQuickActionIntent(.mute)) { Label("Mute phone call", systemImage: "mic.slash") }
        }.displayName("Mute phone call").description("Mute the active DVNT call on your paired phone and show its confirmed state.")
    }
}
