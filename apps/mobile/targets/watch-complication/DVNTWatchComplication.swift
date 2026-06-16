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

        let upcoming = tickets
            .filter { ($0["status"] as? String) == "valid" }
            .compactMap { t -> (String, Date?)? in
                let title = (t["eventTitle"] as? String) ?? "DVNT"
                let date = (t["eventDate"] as? String).flatMap(parse)
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

    func getTimeline(in context: Context, completion: @escaping (Timeline<DVNTEntry>) -> Void) {
        let entry = currentEntry()
        // Refresh hourly; WidgetCenter.reloadAllTimelines() is also called by the
        // watch app when a new ticket set arrives.
        let next = Calendar.current.date(byAdding: .hour, value: 1, to: entry.date) ?? entry.date
        completion(Timeline(entries: [entry], policy: .after(next)))
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

    var body: some View {
        switch family {
        case .accessoryCircular:
            ZStack {
                AccessoryWidgetBackground()
                Image("Glyph")
                    .resizable().scaledToFit().padding(6)
                    .widgetAccentable()
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
                    Text("DVNT").font(.headline).widgetAccentable()
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
