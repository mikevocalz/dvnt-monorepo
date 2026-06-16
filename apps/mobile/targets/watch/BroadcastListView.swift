import SwiftUI
import WatchKit

/// In-app broadcast history. A member who missed the buzz at the venue can scroll
/// what the host said — newest first, pulled from the shared store (synced over
/// WCSession / App Group). One broadcast = one detail screen; the message is the
/// hero and is never truncated.
struct BroadcastListView: View {
    @EnvironmentObject private var broadcasts: BroadcastStore
    @EnvironmentObject private var connectivity: WatchConnectivityManager

    /// When set, scope to a single event (the "Messages from host" view reached
    /// from a ticket's QR screen). When nil, show every broadcast.
    var eventId: String? = nil

    private var items: [WatchBroadcast] {
        if let eventId { return broadcasts.broadcasts(forEvent: eventId) }
        return broadcasts.broadcasts
    }

    var body: some View {
        Group {
            if items.isEmpty {
                EmptyBroadcastsView(reachable: connectivity.isReachable)
            } else {
                List {
                    ForEach(items) { b in
                        NavigationLink {
                            BroadcastDetailView(broadcast: b)
                        } label: {
                            BroadcastRow(broadcast: b)
                        }
                        .listRowBackground(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .fill(Color.white.opacity(b.read ? 0.05 : 0.10))
                        )
                    }
                }
                .listStyle(.carousel)
            }
        }
        .navigationTitle("Host")
        .containerBackground(DVNT.brandGradient.opacity(0.16), for: .navigation)
    }
}

private struct BroadcastRow: View {
    let broadcast: WatchBroadcast

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: broadcast.intent.glyph)
                    .font(.system(size: 12))
                    .foregroundStyle(broadcast.intent.accent)
                Text(broadcast.eventTitle)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(.white.opacity(0.7))
                    .lineLimit(1)
                Spacer(minLength: 4)
                if !broadcast.read {
                    Circle().fill(broadcast.intent.accent).frame(width: 6, height: 6)
                }
            }
            // Two-line preview only — the full message lives on the detail screen.
            Text(broadcast.body)
                .font(.system(size: 14, weight: .medium))
                .foregroundColor(.white)
                .lineLimit(2)
            if let date = broadcast.date {
                Text(date.formatted(.relative(presentation: .named)))
                    .font(.system(size: 10))
                    .foregroundColor(.white.opacity(0.4))
            }
        }
        .padding(.vertical, 3)
    }
}

/// One broadcast, full screen. Hierarchy: message body is the hero (large, high
/// contrast on true-black); host + event secondary; timestamp tertiary.
struct BroadcastDetailView: View {
    let broadcast: WatchBroadcast

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 6) {
                    Image(systemName: broadcast.intent.glyph)
                        .font(.system(size: 16))
                        .foregroundStyle(broadcast.intent.accent)
                    Text(broadcast.title ?? broadcast.eventTitle)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundColor(.white.opacity(0.75))
                        .lineLimit(2)
                }

                // The hero — verbatim, no truncation.
                Text(broadcast.body)
                    .font(.system(size: 19, weight: .semibold))
                    .foregroundColor(.white)
                    .fixedSize(horizontal: false, vertical: true)

                Divider().overlay(Color.white.opacity(0.1))

                VStack(alignment: .leading, spacing: 3) {
                    Label(broadcast.eventTitle, systemImage: "calendar")
                        .font(.system(size: 11))
                        .foregroundColor(.white.opacity(0.55))
                    if let date = broadcast.date {
                        Label(date.formatted(date: .abbreviated, time: .shortened),
                              systemImage: "clock")
                            .font(.system(size: 11))
                            .foregroundColor(.white.opacity(0.4))
                    }
                }
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(DVNT.canvas.ignoresSafeArea())
        .navigationTitle("Message")
    }
}

private struct EmptyBroadcastsView: View {
    let reachable: Bool
    var body: some View {
        ZStack {
            DVNT.canvas.ignoresSafeArea()
            VStack(spacing: 8) {
                Image(systemName: "megaphone")
                    .font(.system(size: 24))
                    .foregroundStyle(DVNT.brandGradient)
                Text("No messages yet")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundColor(.white)
                Text(reachable ? "Host updates appear here."
                               : "Open DVNT on your iPhone to sync.")
                    .font(.system(size: 11))
                    .foregroundColor(.white.opacity(0.5))
                    .multilineTextAlignment(.center)
            }
            .padding()
        }
    }
}
