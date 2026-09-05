import SwiftUI
struct ActiveCallView: View {
    @Environment(ActiveCallStore.self) private var store
    @Environment(\.isLuminanceReduced) private var reduced
    @Environment(\.scenePhase) private var scenePhase
    @State private var visible = false
    var body: some View {
        Group {
            if reduced || scenePhase != .active || !visible {
                VStack(spacing: DVNT.Space.base) {
                    Image(systemName: "phone.fill").font(.system(size: DVNT.TypeScale.Icon.hero))
                    Text("Call on phone").font(DVNT.TypeScale.body())
                    Text("Raise your wrist for controls").font(DVNT.TypeScale.caption()).foregroundStyle(DVNT.textDim)
                }.frame(maxWidth: .infinity, maxHeight: .infinity).background(DVNT.canvas)
            } else {
                TimelineView(.periodic(from: .now, by: 5)) { timeline in
                    if let call = store.call {
                        let fresh = call.expiresAt > timeline.date.timeIntervalSince1970
                        ScrollView {
                            VStack(spacing: DVNT.Space.roomy) {
                                Image(systemName: call.isVideo ? "video.fill" : "phone.fill").font(.system(size: DVNT.TypeScale.Icon.hero))
                                Text(call.name).font(DVNT.TypeScale.title()).multilineTextAlignment(.center)
                                Text(fresh ? status(call.phase) : "Status unavailable").font(DVNT.TypeScale.caption()).foregroundStyle(DVNT.textBright)
                                Text("Audio is on your phone").font(DVNT.TypeScale.caption()).foregroundStyle(DVNT.textDim)
                                if fresh {
                                    Button { store.act("set_muted", muted: !call.muted) } label: { Label(call.muted ? "Unmute phone" : "Mute phone", systemImage: call.muted ? "mic.slash.fill" : "mic.fill") }.disabled(!call.canMute || store.pending != nil)
                                    Button(role: .destructive) { store.act("end") } label: { Label("End call", systemImage: "phone.down.fill") }.disabled(store.pending != nil)
                                }
                                if store.pending != nil { ProgressView("Contacting phone") }
                                if let message = store.message { Text(message).font(DVNT.TypeScale.caption()).foregroundStyle(DVNT.textDim) }
                                Button("Back to DVNT") { store.dismiss() }.font(DVNT.TypeScale.caption())
                                if !fresh { Text("Check your phone for the current call.").font(DVNT.TypeScale.caption()).foregroundStyle(DVNT.textDim) }
                            }.font(DVNT.TypeScale.body()).padding(DVNT.Space.roomy)
                        }.background(DVNT.canvas).privacySensitive()
                    }
                }
            }
        }.onAppear { visible = true }.onDisappear { visible = false }
    }
    private func status(_ phase: String) -> String {
        switch phase { case "connected": "Connected on phone"; case "ringing": "Ringing on phone"; case "reconnecting": "Reconnecting on phone"; default: "Connecting on phone" }
    }
}
