import SwiftUI
import WatchKit

/// The inbox on the wrist. Who wants the member, what they said last, and one
/// line back — that is the whole job. There is no thread history here: reading a
/// conversation is a phone task, answering "on my way" is a wrist task.
struct DMListView: View {
    @EnvironmentObject private var dms: DMStore
    @EnvironmentObject private var connectivity: WatchConnectivityManager

    var body: some View {
        Group {
            if dms.isEmpty {
                EmptyDMsView(reachable: connectivity.isReachable)
            } else {
                List {
                    ForEach(dms.dms) { dm in
                        NavigationLink {
                            DMDetailView(dm: dm)
                        } label: {
                            DMRow(dm: dm)
                        }
                        .listRowBackground(
                            RoundedRectangle(cornerRadius: DVNT.Radius.card, style: .continuous)
                                .fill(dm.unread ? DVNT.hairline : DVNT.Surface.low)
                        )
                    }
                }
                .listStyle(.carousel)
            }
        }
        .navigationTitle("Messages")
        .containerBackground(DVNT.canvas, for: .navigation)
    }
}

private struct DMRow: View {
    let dm: WatchDM

    var body: some View {
        VStack(alignment: .leading, spacing: DVNT.Space.tight) {
            HStack(spacing: DVNT.Space.snug) {
                Image(systemName: dm.isGroup ? "person.2.fill" : "person.fill")
                    .font(.system(size: DVNT.TypeScale.Icon.inline))
                    .foregroundStyle(dm.unread ? DVNT.accent : DVNT.textFaint)
                Text(dm.name)
                    .font(DVNT.TypeScale.title(18))
                    .foregroundColor(.white)
                    .lineLimit(1)
                Spacer(minLength: DVNT.Space.tight)
                if dm.unread {
                    Circle().fill(DVNT.accent).frame(width: 6, height: 6)
                }
            }
            if !dm.preview.isEmpty {
                Text(dm.preview)
                    .font(DVNT.TypeScale.body())
                    .foregroundColor(DVNT.textDim)
                    .lineLimit(2)
            }
            if let date = dm.date {
                Text(date.formatted(.relative(presentation: .named)))
                    .font(DVNT.TypeScale.caption(13))
                    .foregroundColor(DVNT.textFaint)
            }
        }
        .padding(.vertical, DVNT.Space.hair)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(dm.unread
            ? "\(dm.name), unread. \(dm.preview)"
            : "\(dm.name). \(dm.preview)")
    }
}

/// One conversation. The last message is the hero; below it, the reply.
struct DMDetailView: View {
    let dm: WatchDM
    @EnvironmentObject private var dmStore: DMStore
    @EnvironmentObject private var connectivity: WatchConnectivityManager
    @Environment(\.dismiss) private var dismiss
    @State private var sent = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DVNT.Space.roomy) {
                if !dm.handle.isEmpty {
                    Text(dm.handle)
                        .font(DVNT.TypeScale.caption(13))
                        .foregroundColor(DVNT.textFaint)
                }

                Text(dm.preview.isEmpty ? "No messages yet." : dm.preview)
                    .font(DVNT.TypeScale.title(19))
                    .foregroundColor(dm.preview.isEmpty ? DVNT.textFaint : .white)
                    .fixedSize(horizontal: false, vertical: true)

                if let date = dm.date {
                    Text(date.formatted(date: .abbreviated, time: .shortened))
                        .font(DVNT.TypeScale.caption(13))
                        .foregroundColor(DVNT.textFaint)
                }

                Divider().overlay(DVNT.hairline)

                if sent {
                    // The phone owns the send, so the wrist cannot honestly say
                    // "delivered" — only that it handed the line over.
                    Label("Sent from your iPhone", systemImage: "checkmark.circle.fill")
                        .font(DVNT.TypeScale.body())
                        .foregroundStyle(DVNT.accent)
                } else if connectivity.isReachable {
                    // Dictation / scribble / emoji — the system composer. Nothing
                    // is queued if the phone is away, so the affordance is hidden
                    // rather than offered and silently dropped.
                    TextFieldLink("Reply") { text in
                        dmStore.send(conversationId: dm.id, text: text)
                        WKInterfaceDevice.current().play(.success)
                        sent = true
                    }
                    .font(DVNT.TypeScale.body())
                    .tint(DVNT.accent)
                } else {
                    Label("Out of range — reply from your iPhone",
                          systemImage: "iphone.slash")
                        .font(DVNT.TypeScale.caption(13))
                        .foregroundColor(DVNT.textFaint)
                }
            }
            .padding(.horizontal, DVNT.Space.tight)
            .padding(.bottom, DVNT.Space.roomy)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(DVNT.canvas.ignoresSafeArea())
        .navigationTitle(dm.name)
    }
}

private struct EmptyDMsView: View {
    let reachable: Bool
    var body: some View {
        ZStack {
            DVNT.canvas.ignoresSafeArea()
            VStack(spacing: DVNT.Space.base) {
                Image(systemName: "message")
                    .font(.system(size: DVNT.TypeScale.Icon.hero))
                    .foregroundColor(DVNT.accent)
                Text("No messages")
                    .font(DVNT.TypeScale.title())
                    .foregroundColor(.white)
                Text(reachable ? "Conversations appear here."
                               : "Open DVNT on your iPhone to sync.")
                    .font(DVNT.TypeScale.body())
                    .foregroundColor(DVNT.textDim)
                    .multilineTextAlignment(.center)
            }
            .padding()
        }
    }
}
