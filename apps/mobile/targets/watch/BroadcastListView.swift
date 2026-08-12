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
                            RoundedRectangle(cornerRadius: DVNT.Radius.card, style: .continuous)
                                .fill(b.read ? DVNT.Surface.low : DVNT.hairline)
                        )
                    }
                }
                .listStyle(.carousel)
            }
        }
        .navigationTitle("Host")
        .containerBackground(DVNT.canvas, for: .navigation)
    }
}

private struct BroadcastRow: View {
    let broadcast: WatchBroadcast

    var body: some View {
        VStack(alignment: .leading, spacing: DVNT.Space.tight) {
            HStack(spacing: DVNT.Space.snug) {
                // The event's identity, in the header line rather than leading
                // the whole row: the body below is the host's words rendered
                // VERBATIM, and a leading thumb would take ~20% of the width
                // off a 40mm screen's two-line preview. The model header's
                // verbatim rule outranks the artwork.
                //
                // Radius.chip (8), not Radius.card (20). Card radius is tuned
                // for a full-width card; on a 22pt square it renders a circle,
                // which is the DM avatar idiom and would read as a person
                // rather than an event.
                EventArt(
                    dominantHex: broadcast.dominantHex,
                    imageURL: broadcast.eventImageURL,
                    cornerRadius: DVNT.Radius.chip
                )
                .frame(width: 22, height: 22)
                Image(systemName: broadcast.intent.glyph)
                    .font(.system(size: DVNT.TypeScale.Icon.inline))
                    .foregroundStyle(broadcast.intent.accent)
                Text(broadcast.eventTitle)
                    .font(DVNT.TypeScale.caption())
                    .foregroundColor(DVNT.textBright)
                    .lineLimit(1)
                Spacer(minLength: DVNT.Space.tight)
                if !broadcast.read {
                    Circle().fill(broadcast.intent.accent).frame(width: 6, height: 6)
                }
            }
            // Two-line preview only — the full message lives on the detail screen.
            Text(broadcast.body)
                .font(DVNT.TypeScale.body())
                .foregroundColor(.white)
                .lineLimit(2)
            if let date = broadcast.date {
                Text(date.formatted(.relative(presentation: .named)))
                    .font(DVNT.TypeScale.caption())
                    .foregroundColor(DVNT.textFaint)
            }
        }
        .padding(.vertical, DVNT.Space.hair)
    }
}

/// One broadcast, full screen. Hierarchy: message body is the hero (large, high
/// contrast on true-black); host + event secondary; timestamp tertiary.
struct BroadcastDetailView: View {
    let broadcast: WatchBroadcast

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: DVNT.Space.roomy) {
                HStack(spacing: DVNT.Space.snug) {
                    Image(systemName: broadcast.intent.glyph)
                        .font(.system(size: DVNT.TypeScale.Icon.row))
                        .foregroundStyle(broadcast.intent.accent)
                    Text(broadcast.title ?? broadcast.eventTitle)
                        .font(DVNT.TypeScale.caption())
                        .foregroundColor(DVNT.textBright)
                        .lineLimit(2)
                }

                // The hero — verbatim, no truncation.
                Text(broadcast.body)
                    .font(DVNT.TypeScale.title(19))
                    .foregroundColor(.white)
                    .fixedSize(horizontal: false, vertical: true)

                Divider().overlay(DVNT.hairline)

                VStack(alignment: .leading, spacing: DVNT.Space.tight) {
                    Label(broadcast.eventTitle, systemImage: "calendar")
                        .font(DVNT.TypeScale.caption())
                        .foregroundColor(DVNT.textMuted)
                    if let date = broadcast.date {
                        Label(date.formatted(date: .abbreviated, time: .shortened),
                              systemImage: "clock")
                            .font(DVNT.TypeScale.caption())
                            .foregroundColor(DVNT.textFaint)
                    }
                }
            }
            .padding(.horizontal, DVNT.Space.tight)
            .padding(.bottom, DVNT.Space.roomy)
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
            VStack(spacing: DVNT.Space.base) {
                Image(systemName: "megaphone")
                    .font(.system(size: DVNT.TypeScale.Icon.hero))
                    .foregroundColor(DVNT.accent)
                Text("No messages yet")
                    .font(DVNT.TypeScale.title())
                    .foregroundColor(.white)
                Text(reachable ? "Host updates appear here."
                               : "Open DVNT on your iPhone to sync.")
                    .font(DVNT.TypeScale.body())
                    .foregroundColor(DVNT.textMuted)
                    .multilineTextAlignment(.center)
            }
            .padding()
        }
    }
}
