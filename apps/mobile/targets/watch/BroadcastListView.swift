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

/// Internal rather than private: the unified inbox in `EventListView` composes
/// this row alongside `DMRow`. This view stays the single definition of what a
/// broadcast looks like, so the two surfaces cannot drift.
struct BroadcastRow: View {
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
                // .frame does not clip. EventArt's AsyncImage is scaledToFill,
                // so it sizes itself past this frame, gets centred, and spills
                // over the row — its own clipShape clips at ITS bounds, not the
                // 22pt box imposed from out here. The outer clip is what makes
                // the thumb a square.
                .clipShape(
                    RoundedRectangle(cornerRadius: DVNT.Radius.chip, style: .continuous)
                )
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

                // The flyer, if the broadcast carried one. A banner rather
                // than the full image: the host's words are the hero on this
                // screen, and a tall flyer inline would push them off it. Tap
                // opens the flyer full screen.
                if let flyer = broadcast.eventImageURL, !flyer.isEmpty {
                    NavigationLink {
                        FlyerView(
                            imageURL: flyer,
                            dominantHex: broadcast.dominantHex,
                            title: broadcast.eventTitle
                        )
                    } label: {
                        EventArt(
                            dominantHex: broadcast.dominantHex,
                            imageURL: flyer,
                            cornerRadius: DVNT.Radius.card
                        )
                        .frame(height: 76)
                        .frame(maxWidth: .infinity)
                        // .frame does not clip a scaledToFill image.
                        .clipShape(
                            RoundedRectangle(cornerRadius: DVNT.Radius.card,
                                             style: .continuous)
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open flyer")
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

/// The flyer, full screen and scrollable.
///
/// A DVNT flyer is routinely far taller than it is wide and a watch screen is
/// neither, so this is scaledToFit at full width inside a ScrollView: a tall
/// flyer becomes a long vertical scroll, which the Digital Crown drives for
/// free (HIG W-DC-01). Deliberately NOT scaledToFill — cropping a flyer hides
/// the lineup, which is the reason someone opened it.
struct FlyerView: View {
    let imageURL: String
    let dominantHex: String?
    let title: String

    /// HIG W-AC-04: Reduce Motion means no cross-fade, not a slower one.
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ScrollView(.vertical) {
            AsyncImage(
                url: fullSizeURL,
                transaction: Transaction(
                    animation: reduceMotion ? nil : DVNT.Motion.enter
                )
            ) { phase in
                if case .success(let image) = phase {
                    image
                        .resizable()
                        .scaledToFit()
                        .transition(.opacity)
                } else {
                    // Same hex-first rule as EventArt: something branded is on
                    // screen before the network answers, and a failure is
                    // indistinguishable from a slow load.
                    placeholder
                }
            }
            .frame(maxWidth: .infinity)
        }
        .background(DVNT.canvas.ignoresSafeArea())
        .navigationTitle(title)
    }

    /// The row thumb and this screen share one URL, and the phone sized it for
    /// a 22pt tile (`?width=96`). Blown up full screen that is a blur, so ask
    /// the optimizer for a screen-sized rendition — 400px covers a 205pt Ultra
    /// at 2x. Falls back to the URL as given if it will not parse, which is the
    /// pre-optimizer behaviour rather than a broken image.
    private var fullSizeURL: URL? {
        guard var components = URLComponents(string: imageURL) else {
            return URL(string: imageURL)
        }
        var items = (components.queryItems ?? []).filter { $0.name != "width" }
        items.append(URLQueryItem(name: "width", value: "400"))
        components.queryItems = items
        return components.url ?? URL(string: imageURL)
    }

    @ViewBuilder private var placeholder: some View {
        Group {
            if let hex = Color(dvntHex: dominantHex) {
                hex
            } else {
                DVNT.brandGradient.opacity(0.45)
            }
        }
        .frame(height: 140)
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
