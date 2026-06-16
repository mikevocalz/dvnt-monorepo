import SwiftUI
import WidgetKit

private let APP_GROUP = "group.com.dvnt.app"

// ── Brand Colors ──
private let dvntPurple = Color(red: 138/255, green: 64/255, blue: 207/255)
private let dvntCyan   = Color(red: 63/255, green: 220/255, blue: 255/255)
private let dvntRed    = Color(red: 252/255, green: 37/255, blue: 58/255)
private let dvntDark   = Color(red: 14/255, green: 14/255, blue: 16/255)

// ── Compatibility ──
private extension View {
    @ViewBuilder
    func dvntContainerBackground() -> some View {
        if #available(iOSApplicationExtension 17.0, *) {
            self.containerBackground(for: .widget) { dvntDark }
        } else {
            self.background(dvntDark)
        }
    }
}

private extension WidgetConfiguration {
    func dvntContentMarginsDisabled() -> some WidgetConfiguration {
        if #available(iOSApplicationExtension 17.0, *) {
            return self.contentMarginsDisabled()
        } else {
            return self
        }
    }
}

// ── Helpers ──
private func weatherSFSymbol(_ icon: String?) -> String {
    switch icon {
    case "sun":   return "sun.max.fill"
    case "cloud": return "cloud.fill"
    case "rain":  return "cloud.rain.fill"
    case "snow":  return "snowflake"
    case "storm": return "cloud.bolt.fill"
    case "fog":   return "cloud.fog.fill"
    case "wind":  return "wind"
    default:      return "cloud.fill"
    }
}

private func logoImage(size: CGFloat) -> some View {
    if UIImage(named: "dvnt_logo", in: .main, with: nil) != nil {
        return AnyView(Image("dvnt_logo", bundle: .main).resizable().aspectRatio(contentMode: .fit).frame(width: size, height: size).clipShape(RoundedRectangle(cornerRadius: max(2, size * 0.22))))
    }
    return AnyView(Image(systemName: "sparkles.circle.fill").resizable().aspectRatio(contentMode: .fit).frame(width: size, height: size).foregroundColor(dvntPurple))
}

private func heroImage(localPath: String?) -> some View {
    Group {
        if let p = localPath, !p.isEmpty,
           let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: APP_GROUP),
           let img = UIImage(contentsOfFile: container.appendingPathComponent(p).path) {
            Image(uiImage: img).resizable().aspectRatio(contentMode: .fill)
        } else {
            LinearGradient(
                colors: [dvntPurple.opacity(0.4), dvntDark],
                startPoint: .topLeading, endPoint: .bottomTrailing
            )
        }
    }
}

private func countdownString(from isoDate: String?) -> String? {
    guard let dateStr = isoDate, let date = ISO8601DateFormatter().date(from: dateStr) else { return nil }
    let diff = date.timeIntervalSinceNow
    guard diff > 0 else { return nil }
    let h = Int(diff) / 3600; let m = (Int(diff) % 3600) / 60
    if h > 24 { return "in \(h / 24)d" }
    if h > 0  { return "in \(h)h \(m)m" }
    return "in \(m)m"
}

private func dateParts(from iso: String?) -> (day: String, month: String)? {
    guard let dateStr = iso, let date = ISO8601DateFormatter().date(from: dateStr) else { return nil }
    let dayF = DateFormatter(); dayF.dateFormat = "d"
    let monthF = DateFormatter(); monthF.dateFormat = "MMM"
    return (dayF.string(from: date), monthF.string(from: date).uppercased())
}

private func timeString(from iso: String?) -> String? {
    guard let dateStr = iso, let date = ISO8601DateFormatter().date(from: dateStr) else { return nil }
    let f = DateFormatter(); f.dateFormat = "h:mm a"
    return f.string(from: date)
}

// ── Data Model ──
struct SurfacePayload {
    let featured: FeaturedEvent?
    let upcoming: [UpcomingEvent]
    let weather: WeatherData?
    let heroLocalPath: String?

    struct FeaturedEvent {
        let eventId: String?
        let title: String
        let startAt: String?
        let venueName: String?
        let city: String?
        let category: String?
        let isUpcoming: Bool
        let deepLink: String
        let attendeeCount: Int?
    }

    struct UpcomingEvent {
        let eventId: String
        let title: String
        let startAt: String
        let venueName: String?
        let deepLink: String
    }

    struct WeatherData {
        let icon: String?
        let tempF: Int?
        let label: String?
    }

    static func preview() -> SurfacePayload {
        SurfacePayload(
            featured: FeaturedEvent(
                eventId: "1", title: "Summer Block Party",
                startAt: "2026-03-17T20:00:00Z", venueName: "The Venue",
                city: "Brooklyn", category: "Music", isUpcoming: true,
                deepLink: "https://dvntlive.app/e/1", attendeeCount: 142
            ),
            upcoming: [
                UpcomingEvent(eventId: "2", title: "Rooftop Vibes", startAt: "2026-03-18T21:00:00Z", venueName: "Sky Lounge", deepLink: "https://dvntlive.app/e/2"),
                UpcomingEvent(eventId: "3", title: "Art After Dark", startAt: "2026-03-20T19:00:00Z", venueName: "Gallery One", deepLink: "https://dvntlive.app/e/3"),
            ],
            weather: WeatherData(icon: "sun", tempF: 72, label: "Sunny"),
            heroLocalPath: nil
        )
    }

    init(featured: FeaturedEvent?, upcoming: [UpcomingEvent], weather: WeatherData?, heroLocalPath: String?) {
        self.featured = featured; self.upcoming = upcoming; self.weather = weather; self.heroLocalPath = heroLocalPath
    }

    init?(from obj: [String: Any]) {
        let tile1 = obj["tile1"] as? [String: Any]
        featured = tile1.map { t in
            FeaturedEvent(
                eventId: t["eventId"] as? String,
                title: t["title"] as? String ?? "DVNT",
                startAt: t["startAt"] as? String,
                venueName: t["venueName"] as? String,
                city: t["city"] as? String,
                category: t["category"] as? String,
                isUpcoming: t["isUpcoming"] as? Bool ?? false,
                deepLink: t["deepLink"] as? String ?? "https://dvntlive.app/events",
                attendeeCount: t["attendeeCount"] as? Int
            )
        }
        heroLocalPath = tile1?["heroLocalPath"] as? String
        let tile3 = obj["tile3"] as? [String: Any]
        let tile3Arr = (tile3?["items"] as? [[String: Any]]) ?? []
        upcoming = tile3Arr.prefix(3).map { i in
            UpcomingEvent(
                eventId: i["eventId"] as? String ?? "",
                title: i["title"] as? String ?? "Event",
                startAt: i["startAt"] as? String ?? "",
                venueName: i["venueName"] as? String,
                deepLink: i["deepLink"] as? String ?? "https://dvntlive.app/events"
            )
        }
        let w = obj["weather"] as? [String: Any]
        weather = w.map { WeatherData(icon: $0["icon"] as? String, tempF: $0["tempF"] as? Int, label: $0["label"] as? String) }
    }
}

// ── Widget Config ──
struct DVNTHomeWidget: Widget {
    let kind: String = "DVNTHomeWidget"
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: DVNTHomeProvider()) { entry in
            DVNTHomeWidgetView(entry: entry).dvntContainerBackground()
        }
        .configurationDisplayName("DVNT Events")
        .description("Your next event at a glance")
        .supportedFamilies(supportedFamilies)
        .dvntContentMarginsDisabled()
    }

    private var supportedFamilies: [WidgetFamily] {
        var families: [WidgetFamily] = [.systemSmall, .systemMedium, .systemLarge]
        if #available(iOSApplicationExtension 16.0, *) {
            families.append(contentsOf: [.accessoryInline, .accessoryRectangular, .accessoryCircular])
        }
        return families
    }
}

struct DVNTHomeEntry: TimelineEntry {
    let date: Date
    let payload: SurfacePayload?
}

struct DVNTHomeProvider: TimelineProvider {
    private static let previewEntry = DVNTHomeEntry(date: Date(), payload: SurfacePayload.preview())

    func placeholder(in context: Context) -> DVNTHomeEntry { Self.previewEntry }
    func getSnapshot(in context: Context, completion: @escaping (DVNTHomeEntry) -> Void) { completion(Self.previewEntry) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<DVNTHomeEntry>) -> Void) {
        let payload = loadPayload()
        let entry = DVNTHomeEntry(date: Date(), payload: payload ?? SurfacePayload.preview())
        let next = Calendar.current.date(byAdding: .minute, value: 15, to: Date()) ?? Date()
        completion(Timeline(entries: [entry], policy: .after(next)))
    }
    private func loadPayload() -> SurfacePayload? {
        guard let defaults = UserDefaults(suiteName: APP_GROUP),
              let json = defaults.string(forKey: "surfacePayload"),
              let data = json.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return nil }
        return SurfacePayload(from: obj)
    }
}

// ── Widget View Router ──
struct DVNTHomeWidgetView: View {
    @Environment(\.widgetFamily) var family
    let entry: DVNTHomeEntry
    var body: some View {
        switch family {
        case .systemSmall:        SmallEventWidget(payload: entry.payload)
        case .systemMedium:       MediumEventWidget(payload: entry.payload)
        case .systemLarge:        LargeEventWidget(payload: entry.payload)
        case .accessoryInline:    InlineAccessoryWidget(payload: entry.payload)
        case .accessoryRectangular: RectangularAccessoryWidget(payload: entry.payload)
        case .accessoryCircular:  CircularAccessoryWidget(payload: entry.payload)
        default:                  SmallEventWidget(payload: entry.payload)
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// systemSmall — Hero image background, date badge top-right, title + countdown bottom
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
struct SmallEventWidget: View {
    let payload: SurfacePayload?
    var body: some View {
        let ev = payload?.featured
        let linkURL = URL(string: ev?.deepLink ?? "https://dvntlive.app/events")!
        Link(destination: linkURL) {
            ZStack {
                heroImage(localPath: payload?.heroLocalPath)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
                LinearGradient(
                    colors: [.clear, .black.opacity(0.3), .black.opacity(0.85)],
                    startPoint: .top, endPoint: .bottom
                )
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Spacer()
                        if let parts = dateParts(from: ev?.startAt) {
                            VStack(spacing: 0) {
                                Text(parts.day)
                                    .font(.system(size: 20, weight: .bold, design: .rounded))
                                    .foregroundColor(.white)
                                Text(parts.month)
                                    .font(.system(size: 9, weight: .bold))
                                    .foregroundColor(.white.opacity(0.7))
                            }
                            .frame(width: 42, height: 42)
                            .background(Color.black.opacity(0.6))
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        }
                    }
                    .padding(.top, 10).padding(.trailing, 10)
                    Spacer()
                    VStack(alignment: .leading, spacing: 3) {
                        if let e = ev {
                            Text(e.title)
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(.white)
                                .lineLimit(2)
                            HStack(spacing: 4) {
                                if e.isUpcoming, let cd = countdownString(from: e.startAt) {
                                    Text(cd)
                                        .font(.system(size: 10, weight: .semibold))
                                        .foregroundColor(dvntPurple)
                                }
                                if let v = e.venueName {
                                    Text(v)
                                        .font(.system(size: 10))
                                        .foregroundColor(.white.opacity(0.7))
                                        .lineLimit(1)
                                }
                            }
                        } else {
                            logoImage(size: 20)
                            Text("No events")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundColor(.white)
                        }
                    }
                    .padding(.horizontal, 12).padding(.bottom, 12)
                }
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// systemMedium — Hero image full bleed, overlaid details, category + weather + attendees
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
struct MediumEventWidget: View {
    let payload: SurfacePayload?
    var body: some View {
        let ev = payload?.featured
        let linkURL = URL(string: ev?.deepLink ?? "https://dvntlive.app/events")!
        Link(destination: linkURL) {
            ZStack {
                heroImage(localPath: payload?.heroLocalPath)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .clipped()
                LinearGradient(
                    colors: [.clear, .black.opacity(0.2), .black.opacity(0.8)],
                    startPoint: .top, endPoint: .bottom
                )
                HStack(spacing: 0) {
                    VStack(alignment: .leading, spacing: 4) {
                        Spacer()
                        if let cat = ev?.category {
                            Text(cat.uppercased())
                                .font(.system(size: 9, weight: .heavy))
                                .foregroundColor(dvntCyan)
                                .tracking(1.2)
                        }
                        Text(ev?.title ?? "DVNT")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundColor(.white)
                            .lineLimit(2)
                        HStack(spacing: 6) {
                            if let v = ev?.venueName {
                                HStack(spacing: 3) {
                                    Image(systemName: "mappin")
                                        .font(.system(size: 8))
                                        .foregroundColor(.white.opacity(0.5))
                                    Text(v)
                                        .font(.system(size: 11))
                                        .foregroundColor(.white.opacity(0.7))
                                        .lineLimit(1)
                                }
                            }
                            if let time = timeString(from: ev?.startAt) {
                                HStack(spacing: 3) {
                                    Image(systemName: "clock")
                                        .font(.system(size: 8))
                                        .foregroundColor(.white.opacity(0.5))
                                    Text(time)
                                        .font(.system(size: 11))
                                        .foregroundColor(.white.opacity(0.7))
                                }
                            }
                        }
                        HStack(spacing: 8) {
                            if ev?.isUpcoming == true, let cd = countdownString(from: ev?.startAt) {
                                HStack(spacing: 4) {
                                    Image(systemName: "clock.fill")
                                        .font(.system(size: 8))
                                        .foregroundColor(dvntPurple)
                                    Text(cd)
                                        .font(.system(size: 11, weight: .semibold))
                                        .foregroundColor(dvntPurple)
                                }
                                .padding(.horizontal, 8).padding(.vertical, 4)
                                .background(dvntPurple.opacity(0.2))
                                .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                            }
                            if let count = ev?.attendeeCount, count > 0 {
                                HStack(spacing: 3) {
                                    Image(systemName: "person.2.fill")
                                        .font(.system(size: 8))
                                        .foregroundColor(.white.opacity(0.5))
                                    Text("\(count)")
                                        .font(.system(size: 11))
                                        .foregroundColor(.white.opacity(0.7))
                                }
                            }
                        }
                    }
                    .padding(.leading, 14).padding(.bottom, 12)
                    Spacer()
                    VStack {
                        if let parts = dateParts(from: ev?.startAt) {
                            VStack(spacing: 1) {
                                Text(parts.day)
                                    .font(.system(size: 24, weight: .bold, design: .rounded))
                                    .foregroundColor(.white)
                                Text(parts.month)
                                    .font(.system(size: 10, weight: .bold))
                                    .foregroundColor(dvntPurple)
                            }
                            .frame(width: 48, height: 48)
                            .background(Color.black.opacity(0.6))
                            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                        }
                        Spacer()
                        if let icon = payload?.weather?.icon, let temp = payload?.weather?.tempF {
                            HStack(spacing: 3) {
                                Image(systemName: weatherSFSymbol(icon))
                                    .font(.system(size: 10))
                                    .foregroundColor(dvntCyan)
                                Text("\(temp)°")
                                    .font(.system(size: 11, weight: .medium))
                                    .foregroundColor(.white.opacity(0.7))
                            }
                        }
                    }
                    .padding(.trailing, 14).padding(.top, 10).padding(.bottom, 12)
                }
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// systemLarge — Hero event top + "Coming Up" list below
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
struct LargeEventWidget: View {
    let payload: SurfacePayload?
    var body: some View {
        let ev = payload?.featured
        let linkURL = URL(string: ev?.deepLink ?? "https://dvntlive.app/events")!
        VStack(spacing: 0) {
            // Hero section
            Link(destination: linkURL) {
                ZStack(alignment: .bottomLeading) {
                    heroImage(localPath: payload?.heroLocalPath)
                        .frame(height: 180)
                        .frame(maxWidth: .infinity)
                        .clipped()
                    LinearGradient(colors: [.clear, .black.opacity(0.8)],
                                   startPoint: .center, endPoint: .bottom)
                    VStack(alignment: .leading, spacing: 3) {
                        if let cat = ev?.category {
                            Text(cat.uppercased())
                                .font(.system(size: 9, weight: .heavy))
                                .foregroundColor(dvntCyan)
                                .tracking(1.2)
                        }
                        Text(ev?.title ?? "DVNT")
                            .font(.system(size: 18, weight: .bold))
                            .foregroundColor(.white)
                            .lineLimit(2)
                        HStack(spacing: 8) {
                            if let v = ev?.venueName {
                                HStack(spacing: 3) {
                                    Image(systemName: "mappin")
                                        .font(.system(size: 8))
                                        .foregroundColor(.white.opacity(0.5))
                                    Text(v)
                                        .font(.system(size: 11))
                                        .foregroundColor(.white.opacity(0.7))
                                }
                            }
                            if ev?.isUpcoming == true, let cd = countdownString(from: ev?.startAt) {
                                Text(cd)
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(dvntPurple)
                            }
                        }
                    }
                    .padding(.horizontal, 14).padding(.bottom, 12)
                }
            }

            // "Coming Up" section
            VStack(alignment: .leading, spacing: 0) {
                HStack {
                    Text("COMING UP")
                        .font(.system(size: 10, weight: .heavy))
                        .foregroundColor(.white.opacity(0.4))
                        .tracking(1.5)
                    Spacer()
                    if let icon = payload?.weather?.icon, let temp = payload?.weather?.tempF {
                        HStack(spacing: 3) {
                            Image(systemName: weatherSFSymbol(icon))
                                .font(.system(size: 9))
                                .foregroundColor(dvntCyan)
                            Text("\(temp)°")
                                .font(.system(size: 10, weight: .medium))
                                .foregroundColor(.white.opacity(0.5))
                        }
                    }
                }
                .padding(.horizontal, 14).padding(.top, 10).padding(.bottom, 6)

                let events = payload?.upcoming ?? []
                if events.isEmpty {
                    HStack {
                        Spacer()
                        VStack(spacing: 4) {
                            Image(systemName: "calendar")
                                .font(.system(size: 16))
                                .foregroundColor(.white.opacity(0.3))
                            Text("No upcoming events")
                                .font(.system(size: 12))
                                .foregroundColor(.white.opacity(0.4))
                        }
                        .padding(.vertical, 12)
                        Spacer()
                    }
                } else {
                    ForEach(Array(events.prefix(3).enumerated()), id: \.offset) { _, event in
                        Link(destination: URL(string: event.deepLink) ?? URL(string: "https://dvntlive.app/events")!) {
                            HStack(spacing: 10) {
                                if let parts = dateParts(from: event.startAt) {
                                    VStack(spacing: 0) {
                                        Text(parts.day)
                                            .font(.system(size: 15, weight: .bold, design: .rounded))
                                            .foregroundColor(.white)
                                        Text(parts.month)
                                            .font(.system(size: 8, weight: .bold))
                                            .foregroundColor(dvntPurple)
                                    }
                                    .frame(width: 36, height: 36)
                                    .background(Color.white.opacity(0.08))
                                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                                }
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(event.title)
                                        .font(.system(size: 13, weight: .semibold))
                                        .foregroundColor(.white)
                                        .lineLimit(1)
                                    HStack(spacing: 4) {
                                        if let v = event.venueName {
                                            Text(v)
                                                .font(.system(size: 10))
                                                .foregroundColor(.white.opacity(0.5))
                                                .lineLimit(1)
                                        }
                                        if let time = timeString(from: event.startAt) {
                                            Text("·").foregroundColor(.white.opacity(0.3))
                                            Text(time)
                                                .font(.system(size: 10))
                                                .foregroundColor(.white.opacity(0.5))
                                        }
                                    }
                                }
                                Spacer()
                                Image(systemName: "chevron.right")
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundColor(.white.opacity(0.2))
                            }
                            .padding(.horizontal, 14).padding(.vertical, 6)
                        }
                    }
                }
            }
            Spacer(minLength: 0)
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Lock Screen: accessoryInline
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@available(iOSApplicationExtension 16.0, *)
struct InlineAccessoryWidget: View {
    let payload: SurfacePayload?
    var body: some View {
        if let ev = payload?.featured {
            if let cd = countdownString(from: ev.startAt) {
                Text("\(ev.title) · \(cd)")
                    .lineLimit(1)
            } else {
                Text(ev.title)
                    .lineLimit(1)
            }
        } else {
            Text("DVNT")
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Lock Screen: accessoryRectangular
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@available(iOSApplicationExtension 16.0, *)
struct RectangularAccessoryWidget: View {
    let payload: SurfacePayload?
    var body: some View {
        if let ev = payload?.featured {
            VStack(alignment: .leading, spacing: 2) {
                Text(ev.title)
                    .font(.system(size: 14, weight: .bold))
                    .lineLimit(1)
                    .widgetAccentable()
                if let v = ev.venueName {
                    HStack(spacing: 3) {
                        Image(systemName: "mappin")
                            .font(.system(size: 8))
                        Text(v)
                            .font(.system(size: 11))
                            .lineLimit(1)
                    }
                }
                if ev.isUpcoming, let cd = countdownString(from: ev.startAt) {
                    HStack(spacing: 3) {
                        Image(systemName: "clock.fill")
                            .font(.system(size: 8))
                        Text(cd)
                            .font(.system(size: 11, weight: .semibold))
                    }
                } else if let time = timeString(from: ev.startAt) {
                    Text(time)
                        .font(.system(size: 11))
                }
            }
        } else {
            VStack(alignment: .leading, spacing: 2) {
                Text("DVNT")
                    .font(.system(size: 14, weight: .bold))
                    .widgetAccentable()
                Text("No upcoming events")
                    .font(.system(size: 11))
            }
        }
    }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Lock Screen: accessoryCircular
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
@available(iOSApplicationExtension 16.0, *)
struct CircularAccessoryWidget: View {
    let payload: SurfacePayload?
    var body: some View {
        if let ev = payload?.featured, let parts = dateParts(from: ev.startAt) {
            ZStack {
                AccessoryWidgetBackground()
                VStack(spacing: 0) {
                    Text(parts.day)
                        .font(.system(size: 18, weight: .bold, design: .rounded))
                    Text(parts.month)
                        .font(.system(size: 8, weight: .bold))
                        .widgetAccentable()
                }
            }
        } else {
            ZStack {
                AccessoryWidgetBackground()
                Image(systemName: "calendar")
                    .font(.system(size: 18, weight: .medium))
            }
        }
    }
}
