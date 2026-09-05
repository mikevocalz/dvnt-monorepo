import WidgetKit
import SwiftUI
import RelevanceKit
import AppIntents
import CoreLocation

struct DVNTEntry: TimelineEntry {
    let date: Date
    let snapshot: ComplicationSnapshot
    let showsDetails: Bool
    static var preview: DVNTEntry { DVNTEntry(date: Date(), snapshot: .empty, showsDetails: false) }
    static func current() -> DVNTEntry {
        DVNTEntry(date: Date(), snapshot: ComplicationCache.snapshot(),
            showsDetails: UserDefaults(suiteName: ComplicationCache.appGroup)?.bool(forKey: "dvnt.widget.showDetails") == true)
    }
}
struct DVNTProvider: TimelineProvider {
    func placeholder(in context: Context) -> DVNTEntry { .preview }
    func getSnapshot(in context: Context, completion: @escaping (DVNTEntry) -> Void) {
        completion(context.isPreview ? .preview : .current())
    }
    func getTimeline(in context: Context, completion: @escaping (Timeline<DVNTEntry>) -> Void) {
        let entry = DVNTEntry.current()
        // Render countdown progression without waking the extension for every tick.
        if let doors = entry.snapshot.eventDate, doors > entry.date,
           doors.timeIntervalSince(entry.date) <= 86400 {
            let step = max(doors.timeIntervalSince(entry.date) / 90, 600)
            var entries = [entry]
            var date = entry.date.addingTimeInterval(step)
            while date < doors {
                entries.append(DVNTEntry(date: date, snapshot: entry.snapshot, showsDetails: entry.showsDetails))
                date = date.addingTimeInterval(step)
            }
            entries.append(DVNTEntry(date: doors, snapshot: entry.snapshot, showsDetails: entry.showsDetails))
            completion(Timeline(entries: entries, policy: .after(doors)))
        } else {
            // A refresh request, not a guaranteed execution schedule.
            completion(Timeline(entries: [entry], policy: .after(entry.date.addingTimeInterval(900))))
        }
    }
}
struct DVNTComplicationView: View {
    @Environment(\.widgetFamily) private var family
    @Environment(\.isLuminanceReduced) private var dimmed
    let entry: DVNTEntry
    private var stale: Bool { entry.snapshot.isStale(at: entry.date) }
    var body: some View {
        Group {
            switch family {
            case .accessoryCircular:
                Group {
                    if entry.showsDetails && !dimmed, let doors = entry.snapshot.eventDate,
                       doors.timeIntervalSince(entry.date) <= 86400 {
                        Gauge(value: min(max(1 - doors.timeIntervalSince(entry.date) / 86400, 0), 1)) {
                            Image("Glyph")
                        } currentValueLabel: { Image("Glyph").resizable().scaledToFit().padding(3) }
                            .gaugeStyle(.accessoryCircularCapacity).widgetAccentable().privacySensitive()
                    } else {
                        ZStack {
                            AccessoryWidgetBackground()
                            Image("Glyph").resizable().scaledToFit().padding(6).widgetAccentable()
                        }
                    }
                }
                .accessibilityLabel(stale ? "DVNT, cached details. Open to sync." : "DVNT, open saved event")
            case .accessoryInline:
                Text(stale ? "DVNT · Cached" : "DVNT · Open")
            default:
                VStack(alignment: .leading, spacing: 2) {
                    Image("Glyph").resizable().scaledToFit().frame(height: 13).widgetAccentable()
                    if entry.showsDetails && !dimmed {
                        Text(entry.snapshot.title).font(.caption).lineLimit(1).privacySensitive()
                        if let arrived = entry.snapshot.doorArrived {
                            Text("Door · \(arrived) arrived").font(.caption2).privacySensitive()
                        } else if entry.snapshot.unreadCount > 0 {
                            Text("\(entry.snapshot.unreadCount) unread chats").font(.caption2).privacySensitive()
                        }
                        if let date = entry.snapshot.eventDate {
                            Text(date, style: .relative).font(.caption2).privacySensitive()
                        }
                    } else {
                        Text("Open DVNT").font(.caption)
                    }
                    if entry.snapshot.syncedAt > 0 {
                        Text("\(stale ? "Cached" : "Synced") \(Date(timeIntervalSince1970: entry.snapshot.syncedAt), style: .relative)")
                            .font(.caption2).foregroundStyle(.secondary)
                    } else {
                        Text("Open app to sync").font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
        }
        .widgetURL(entry.snapshot.url)
        .containerBackground(.black, for: .widget)
    }
}
struct DVNTWatchComplication: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "DVNTWatchComplication", provider: DVNTProvider()) { entry in
            DVNTComplicationView(entry: entry)
        }
        .configurationDisplayName("DVNT Ticket")
        .description("Open your cached ticket or next event. Details are private by default.")
        .supportedFamilies([.accessoryCircular, .accessoryInline, .accessoryRectangular])
    }
}

@available(watchOS 26.0, *)
struct DVNTRelevantConfiguration: WidgetConfigurationIntent {
    static var title: LocalizedStringResource = "DVNT Event"
}
@available(watchOS 26.0, *)
struct DVNTRelevantEntry: RelevanceEntry { let entry: DVNTEntry }
@available(watchOS 26.0, *)
struct DVNTRelevanceProvider: RelevanceEntriesProvider {
    func relevance() async -> WidgetRelevance<DVNTRelevantConfiguration> {
        let snapshot = ComplicationCache.snapshot()
        guard let date = snapshot.eventDate, snapshot.url != nil else { return WidgetRelevance([]) }
        let end = snapshot.eventEnd ?? date.addingTimeInterval(8 * 3600)
        guard end > Date(), end > date else { return WidgetRelevance([]) }
        var attributes = [WidgetRelevanceAttribute(configuration: DVNTRelevantConfiguration(),
            context: .date(interval: DateInterval(start: date.addingTimeInterval(-2 * 3600), end: end), kind: .scheduled))]
        let authorization = CLLocationManager().authorizationStatus
        if (authorization == .authorizedAlways || authorization == .authorizedWhenInUse),
           let lat = snapshot.latitude, let lng = snapshot.longitude {
            // Published venue coordinates only; the system owns relevance. No location is sent to DVNT.
            let venue = CLCircularRegion(center: CLLocationCoordinate2D(latitude: lat, longitude: lng), radius: 150, identifier: "dvnt.event.venue")
            attributes.append(WidgetRelevanceAttribute(configuration: DVNTRelevantConfiguration(), context: .location(venue)))
        }
        return WidgetRelevance(attributes)
    }
    func entry(configuration: DVNTRelevantConfiguration, context: Context) async throws -> DVNTRelevantEntry {
        DVNTRelevantEntry(entry: context.isPreview ? .preview : .current())
    }
    func placeholder(context: Context) -> DVNTRelevantEntry { DVNTRelevantEntry(entry: .preview) }
}
@available(watchOS 26.0, *)
struct DVNTRelevantWidget: Widget {
    var body: some WidgetConfiguration {
        RelevanceConfiguration(kind: "DVNTRelevantEvent", provider: DVNTRelevanceProvider()) { entry in
            DVNTComplicationView(entry: entry.entry)
        }
        .associatedKind("DVNTWatchComplication")
        .configurationDisplayName("DVNT Event")
        .description("Your next saved event when its published date is relevant.")
    }
}

@main struct DVNTWatchWidgetBundle: WidgetBundle {
    var body: some Widget {
        DVNTWatchComplication()
        if #available(watchOS 26.0, *) {
            DVNTRelevantWidget()
            DVNTShowTicketControl()
            DVNTPresenceControl()
            DVNTMuteCallControl()
            DVNTWidgetPrivacyControl()
        }
    }
}
