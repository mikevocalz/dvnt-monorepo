import SwiftUI

/// Host mode — the door, at a glance.
///
/// Two big numbers (in / still outside) because those are the two a host acts
/// on, then the priority lane, then the soft one. Sized against the
/// glanceability floor in Theme.swift: this gets read at arm's length, in the
/// dark, with a queue in front of you.
struct DoorView: View {
    @EnvironmentObject private var doors: DoorStore
    @EnvironmentObject private var connectivity: WatchConnectivityManager

    var body: some View {
        Group {
            if let d = doors.door {
                ScrollView {
                    VStack(alignment: .leading, spacing: DVNT.Space.roomy) {
                        if let error = doors.error {
                            Text(error).font(DVNT.TypeScale.body())
                            Button("Retry") { connectivity.requestSync() }
                        }
                        Text(d.eventTitle)
                            .font(DVNT.TypeScale.caption(13))
                            .foregroundColor(DVNT.textDim)
                            .lineLimit(1)

                        HStack(spacing: DVNT.Space.base) {
                            DoorNumber(value: d.arrived, label: "IN", accent: DVNT.cyan)
                            DoorNumber(
                                value: d.remaining,
                                label: "OUTSIDE",
                                accent: DVNT.magenta
                            )
                        }

                        if d.priorityLane > 0 {
                            DoorRow(
                                label: "Priority lane",
                                value: "\(d.priorityLane)",
                                accent: DVNT.gold
                            )
                        }
                        if d.approaching > 0 {
                            DoorRow(
                                label: "Approaching",
                                value: "\(d.approaching)",
                                accent: DVNT.violet
                            )
                        }
                        DoorRow(
                            label: "Expected",
                            value: "\(d.expected)",
                            accent: DVNT.textFaint
                        )

                        NavigationLink("Send notice") { VenueNoticeView(eventId: d.eventId) }
                        SnapshotFreshness(label: "Door", syncedAt: doors.syncedAt)
                        PhoneLinkStatus()
                    }
                    .padding(.horizontal, DVNT.Space.tight)
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            } else if let error = doors.error {
                ScrollView {
                    VStack(spacing: DVNT.Space.base) {
                        Text("Door unavailable").font(DVNT.TypeScale.title())
                        Text(error).font(DVNT.TypeScale.body())
                        Button("Retry") { connectivity.requestSync() }
                        SnapshotFreshness(label: "Door", syncedAt: doors.syncedAt)
                        PhoneLinkStatus()
                    }.padding()
                }
            } else {
                VStack(spacing: DVNT.Space.base) {
                    Image(systemName: "door.left.hand.open")
                        .font(.system(size: DVNT.TypeScale.Icon.hero))
                        .foregroundColor(DVNT.accent)
                    Text("No event running")
                        .font(DVNT.TypeScale.title())
                        .foregroundColor(.white)
                    Text("Door counts appear here while you're hosting.")
                        .font(DVNT.TypeScale.body())
                        .foregroundColor(DVNT.textDim)
                        .multilineTextAlignment(.center)
                }
                .padding()
            }
        }
        .navigationTitle("Door")
        .containerBackground(DVNT.canvas, for: .navigation)
    }
}

private struct DoorNumber: View {
    let value: Int
    let label: String
    let accent: Color

    var body: some View {
        VStack(spacing: DVNT.Space.hair) {
            Text("\(value)")
                .font(DVNT.TypeScale.numeralStamp(34))
                .foregroundColor(accent)
                .minimumScaleFactor(0.6)
                .lineLimit(1)
            Text(label)
                .font(DVNT.TypeScale.stamp(13))
                .tracking(DVNT.TypeScale.stampTracking)
                .foregroundColor(DVNT.textDim)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, DVNT.Space.base)
        .background(
            RoundedRectangle(cornerRadius: DVNT.Radius.card, style: .continuous)
                .fill(DVNT.surface)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(value) \(label.lowercased())")
    }
}

private struct DoorRow: View {
    let label: String
    let value: String
    let accent: Color

    var body: some View {
        HStack {
            Text(label)
                .font(DVNT.TypeScale.body())
                .foregroundColor(DVNT.textDim)
            Spacer(minLength: DVNT.Space.tight)
            Text(value)
                .font(DVNT.TypeScale.title(18))
                .foregroundColor(accent)
        }
        .accessibilityElement(children: .combine)
    }
}
