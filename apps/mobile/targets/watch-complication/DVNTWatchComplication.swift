import WidgetKit
import SwiftUI

// MARK: - Shared cache read (App Group, same as the watch app)

private enum ComplicationCache {
    static let appGroup = "group.com.dvnt.app.watch"
    static let storageKey = "dvnt.tickets.envelope"

    /// The next upcoming presentable event: (title, date). Pure read from the
    /// shared container — the complication never hits the network.
    static func nextEvent() -> (title: String, date: Date?)? {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let data = defaults.data(forKey: storageKey),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let tickets = json["tickets"] as? [[String: Any]]
        else { return nil }

        // A `valid` row for an event that already ended would otherwise squat on
        // the watch face indefinitely — the DB never flips it, and the wearer has
        // no way to dismiss a complication. Drop anything past its end (or past
        // doors + 8h when no end is published), mirroring RingPhase in the app.
        let now = Date()
        let upcoming = tickets
            .filter { ($0["status"] as? String) == "valid" }
            .compactMap { t -> (String, Date?)? in
                let title = (t["eventTitle"] as? String) ?? "DVNT"
                let date = (t["eventDate"] as? String).flatMap(parse)
                if let date {
                    let ends = (t["eventEndDate"] as? String).flatMap(parse)
                        ?? date.addingTimeInterval(8 * 3600)
                    guard now < ends else { return nil }
                }
                return (title, date)
            }
            .sorted { lhs, rhs in
                switch (lhs.1, rhs.1) {
                case let (.some(a), .some(b)): return a < b
                case (.some, .none): return true
                default: return false
                }
            }
        return upcoming.first
    }

    static func parse(_ iso: String) -> Date? {
        let f = ISO8601DateFormatter()
        f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return f.date(from: iso) ?? {
            f.formatOptions = [.withInternetDateTime]
            return f.date(from: iso)
        }()
    }

    /// The most recent host broadcast body, if recent — pure read from the shared
    /// container (same App Group as the watch app's BroadcastStore). Lets the
    /// complication flip to "Host: …" for a glance without raising the app.
    static func latestBroadcast() -> String? {
        guard let defaults = UserDefaults(suiteName: appGroup),
              let data = defaults.data(forKey: "dvnt.broadcasts.envelope"),
              let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let rows = json["broadcasts"] as? [[String: Any]]
        else { return nil }

        let newest = rows
            .compactMap { r -> (String, Double)? in
                guard let body = r["body"] as? String, !body.isEmpty else { return nil }
                return (body, (r["createdAt"] as? Double) ?? 0)
            }
            .max { $0.1 < $1.1 }

        // Only surface a recent broadcast (last 3h) so a stale message doesn't
        // squat on the watch face.
        guard let newest, newest.1 > 0 else { return nil }
        let age = Date().timeIntervalSince1970 - newest.1
        return age < 3 * 3600 ? newest.0 : nil
    }
}

// MARK: - Timeline

struct DVNTEntry: TimelineEntry {
    let date: Date
    let title: String
    let eventDate: Date?
    let broadcast: String?
}

struct DVNTProvider: TimelineProvider {
    func placeholder(in context: Context) -> DVNTEntry {
        DVNTEntry(date: Date(), title: "DVNT", eventDate: nil, broadcast: nil)
    }

    func getSnapshot(in context: Context, completion: @escaping (DVNTEntry) -> Void) {
        completion(currentEntry())
    }

    /// The countdown window the circular gauge fills across — the same 24 hours
    /// `RingPhase` uses in the app, so the face and the pass never disagree.
    static let window: TimeInterval = 24 * 3600

    func getTimeline(in context: Context, completion: @escaping (Timeline<DVNTEntry>) -> Void) {
        let entry = currentEntry()

        // One hourly entry left the gauge up to 59 minutes stale — which on the
        // night of an event is the whole point of the complication. Pre-render a
        // run of entries instead: WidgetKit renders them without waking us, so a
        // tightening cadence costs no extra refresh budget. Outside the window
        // there is nothing to count down, so one entry is right.
        guard let doors = entry.eventDate, doors > entry.date,
              doors.timeIntervalSince(entry.date) <= Self.window
        else {
            let next = Calendar.current.date(byAdding: .hour, value: 1, to: entry.date) ?? entry.date
            completion(Timeline(entries: [entry], policy: .after(next)))
            return
        }

        let remaining = doors.timeIntervalSince(entry.date)
        // ~10 min apart, capped so we stay well inside WidgetKit's entry budget.
        let step = max(remaining / 90, 600)
        var entries: [DVNTEntry] = []
        var t = entry.date
        while t < doors {
            entries.append(DVNTEntry(date: t, title: entry.title,
                                     eventDate: doors, broadcast: entry.broadcast))
            t = t.addingTimeInterval(step)
        }
        // Land one exactly on doors so the gauge reads full the moment it matters.
        entries.append(DVNTEntry(date: doors, title: entry.title,
                                 eventDate: doors, broadcast: entry.broadcast))
        completion(Timeline(entries: entries, policy: .after(doors)))
    }

    private func currentEntry() -> DVNTEntry {
        let next = ComplicationCache.nextEvent()
        return DVNTEntry(
            date: Date(),
            title: next?.title ?? "DVNT",
            eventDate: next?.date,
            broadcast: ComplicationCache.latestBroadcast()
        )
    }
}

// MARK: - Views (accessory families)

struct DVNTComplicationView: View {
    @Environment(\.widgetFamily) private var family
    let entry: DVNTEntry

    /// 0…1 across the last 24 hours before doors, or nil when there is nothing
    /// to count to. Computed from `entry.date`, not `Date()`, so a pre-rendered
    /// timeline entry draws the fill for the moment it represents.
    private var countdownFill: Double? {
        guard let doors = entry.eventDate else { return nil }
        let remaining = doors.timeIntervalSince(entry.date)
        guard remaining <= DVNTProvider.window else { return nil }
        guard remaining > 0 else { return 1 }
        return min(max(1 - (remaining / DVNTProvider.window), 0), 1)
    }

    var body: some View {
        switch family {
        case .accessoryCircular:
            // The AccessRing, at watch-face scale. A bare glyph told the wearer
            // nothing they did not already know from having the app installed;
            // a filling gauge is the actual glance — "how close is tonight".
            // Falls back to the mark when there is no dated event to count to.
            if let fill = countdownFill {
                Gauge(value: fill) {
                    Image("Glyph").resizable().scaledToFit()
                } currentValueLabel: {
                    Image("Glyph").resizable().scaledToFit().padding(3)
                }
                .gaugeStyle(.accessoryCircularCapacity)
                .widgetAccentable()
            } else {
                ZStack {
                    AccessoryWidgetBackground()
                    Image("Glyph")
                        .resizable().scaledToFit().padding(6)
                        .widgetAccentable()
                }
            }
        case .accessoryInline:
            if let d = entry.eventDate {
                Text("DVNT · \(d, style: .relative)")
            } else {
                Text("DVNT")
            }
        case .accessoryRectangular:
            VStack(alignment: .leading, spacing: 2) {
                if let msg = entry.broadcast {
                    // A recent host message wins the glance.
                    Label("Host", systemImage: "megaphone.fill")
                        .font(.headline).widgetAccentable()
                    Text(msg).font(.caption).lineLimit(2)
                } else {
                    // Brand mark, not a text wordmark. accessoryRectangular is
                    // the only accessory family that can carry an image
                    // alongside text — circular/corner already use the glyph,
                    // and accessoryInline is a single text line by watchOS
                    // design, so that one has to stay text.
                    Image("Glyph")
                        .resizable().scaledToFit()
                        .frame(height: 13)
                        .widgetAccentable()
                    Text(entry.title).font(.caption).lineLimit(1)
                    if let d = entry.eventDate {
                        Text(d, style: .relative).font(.caption2).foregroundStyle(.secondary)
                    } else {
                        Text("Tap to show ticket").font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
        default:
            Image("Glyph").resizable().scaledToFit().widgetAccentable()
        }
    }
}

// MARK: - Widget

@main
struct DVNTWatchComplication: Widget {
    let kind = "DVNTWatchComplication"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DVNTProvider()) { entry in
            DVNTComplicationView(entry: entry)
        }
        .configurationDisplayName("DVNT Ticket")
        .description("Your next event countdown — tap to show your ticket.")
        .supportedFamilies([.accessoryCircular, .accessoryInline, .accessoryRectangular])
    }
}
