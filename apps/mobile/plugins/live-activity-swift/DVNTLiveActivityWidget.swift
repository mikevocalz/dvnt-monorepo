import ActivityKit
import SwiftUI
import UIKit
import WidgetKit

private let APP_GROUP = "group.com.dvnt.app"

// ── Brand Colors ──
private let dvntPurple = Color(red: 0.541, green: 0.251, blue: 0.812)
private let dvntCyan = Color(red: 0.247, green: 0.863, blue: 1.0)
private let dvntRed = Color(red: 0.988, green: 0.145, blue: 0.227)
private let dvntDark = Color(red: 14/255, green: 14/255, blue: 16/255)

private func weatherSFSymbol(_ icon: String?) -> String {
    switch icon {
    case "sun": return "sun.max.fill"
    case "cloud": return "cloud.fill"
    case "rain": return "cloud.rain.fill"
    case "snow": return "snowflake"
    case "storm": return "cloud.bolt.fill"
    case "fog": return "cloud.fog.fill"
    case "wind": return "wind"
    default: return "cloud.fill"
    }
}

private func logoImage(size: CGFloat) -> some View {
    let bundle = Bundle.main
    if UIImage(named: "dvnt_logo", in: bundle, with: nil) != nil {
        return AnyView(
            Image("dvnt_logo", bundle: bundle)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: max(2, size * 0.22)))
        )
    }
    return AnyView(
        Image(systemName: "sparkles.circle.fill")
            .resizable()
            .aspectRatio(contentMode: .fit)
            .frame(width: size, height: size)
            .foregroundColor(dvntPurple)
    )
}

private func logoGlyphImage(size: CGFloat) -> some View {
    let bundle = Bundle.main
    if UIImage(named: "dvnt_logo_glyph", in: bundle, with: nil) != nil {
        return AnyView(
            Image("dvnt_logo_glyph", bundle: bundle)
                .resizable()
                .aspectRatio(contentMode: .fit)
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: max(2, size * 0.22)))
        )
    }
    return AnyView(logoImage(size: size))
}

private func heroLocalPathFromDefaults() -> String? {
    guard let defaults = UserDefaults(suiteName: APP_GROUP),
          let json = defaults.string(forKey: "surfacePayload"),
          let data = json.data(using: .utf8),
          let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
          let tile1 = obj["tile1"] as? [String: Any] else { return nil }
    return tile1["heroLocalPath"] as? String
}

private func resolvedHeroPath(contentStatePath: String?) -> String? {
    if let p = contentStatePath, !p.isEmpty { return p }
    return heroLocalPathFromDefaults()
}

private func heroImage(localPath: String?) -> some View {
    Group {
        if let p = resolvedHeroPath(contentStatePath: localPath), !p.isEmpty,
           let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: APP_GROUP),
           let img = UIImage(contentsOfFile: container.appendingPathComponent(p).path) {
            Image(uiImage: img)
                .resizable()
                .aspectRatio(contentMode: .fill)
        } else {
            LinearGradient(
                colors: [dvntPurple.opacity(0.7), Color(red: 0.15, green: 0.10, blue: 0.22)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }
}

private func countdownString(from isoDate: String?) -> String? {
    guard let dateStr = isoDate,
          let date = ISO8601DateFormatter().date(from: dateStr) else { return nil }
    let diff = date.timeIntervalSinceNow
    guard diff > 0 else { return nil }
    let hours = Int(diff) / 3600
    let minutes = (Int(diff) % 3600) / 60
    if hours > 0 { return "\(hours)h \(minutes)m" }
    return "\(minutes)m"
}

private func dateParts(from iso: String?) -> (day: String, month: String)? {
    guard let dateStr = iso, let date = ISO8601DateFormatter().date(from: dateStr) else { return nil }
    let dayF = DateFormatter(); dayF.dateFormat = "d"
    let monthF = DateFormatter(); monthF.dateFormat = "MMM"
    return (dayF.string(from: date), monthF.string(from: date).uppercased())
}

private func formatShortTime(_ iso: String?) -> String? {
    guard let dateStr = iso, let date = ISO8601DateFormatter().date(from: dateStr) else { return nil }
    let f = DateFormatter(); f.dateFormat = "h:mm a"
    return f.string(from: date)
}

// ── Lock-Screen Banner ──
@available(iOS 16.1, *)
struct DVNTLockScreenView: View {
    let context: ActivityViewContext<DVNTLiveAttributes>

    var body: some View {
        let s = context.state
        Link(destination: URL(string: s.deepLink) ?? URL(string: "https://dvntlive.app/events")!) {
            HStack(spacing: 12) {
                heroImage(localPath: s.heroLocalPath)
                    .frame(width: 56, height: 56)
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))

                VStack(alignment: .leading, spacing: 3) {
                    Text(s.title)
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(.white)
                        .lineLimit(2)
                    if let venue = s.venueName {
                        HStack(spacing: 3) {
                            Image(systemName: "mappin")
                                .font(.system(size: 8))
                                .foregroundColor(.white.opacity(0.5))
                            Text(venue)
                                .font(.system(size: 11))
                                .foregroundColor(.white.opacity(0.7))
                                .lineLimit(1)
                        }
                    }
                    HStack(spacing: 8) {
                        if s.isLive {
                            HStack(spacing: 4) {
                                Circle().fill(dvntRed).frame(width: 6, height: 6)
                                Text("LIVE")
                                    .font(.system(size: 10, weight: .heavy))
                                    .foregroundColor(dvntRed)
                            }
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(dvntRed.opacity(0.15))
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        } else if s.isUpcoming, let cd = countdownString(from: s.startAt) {
                            HStack(spacing: 4) {
                                Image(systemName: "clock.fill")
                                    .font(.system(size: 8))
                                    .foregroundColor(dvntPurple)
                                Text(cd)
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(dvntPurple)
                            }
                            .padding(.horizontal, 8).padding(.vertical, 3)
                            .background(dvntPurple.opacity(0.15))
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        if let count = s.attendeeCount, count > 0 {
                            HStack(spacing: 3) {
                                Image(systemName: "person.2.fill")
                                    .font(.system(size: 8))
                                    .foregroundColor(.white.opacity(0.5))
                                Text("\(count)")
                                    .font(.system(size: 10))
                                    .foregroundColor(.white.opacity(0.6))
                            }
                        }
                        Spacer()
                        if let icon = s.weatherIcon, let temp = s.weatherTempF {
                            HStack(spacing: 3) {
                                Image(systemName: weatherSFSymbol(icon))
                                    .font(.system(size: 9))
                                    .foregroundColor(dvntCyan)
                                Text("\(temp)°")
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundColor(.white.opacity(0.6))
                            }
                        }
                    }
                }
            }
            .padding(12)
            .background(dvntDark)
        }
    }
}

// ── Widget Configuration ──
@available(iOS 16.1, *)
struct DVNTLiveActivityWidget: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: DVNTLiveAttributes.self) { context in
            DVNTLockScreenView(context: context)
        } dynamicIsland: { context in
            DynamicIsland {
                // Expanded leading: hero thumbnail
                DynamicIslandExpandedRegion(.leading) {
                    heroImage(localPath: context.state.heroLocalPath)
                        .frame(width: 52, height: 52)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
                // Expanded center: title + venue
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 3) {
                        Text(context.state.title)
                            .font(.system(size: 14, weight: .bold))
                            .foregroundColor(.white)
                            .lineLimit(2)
                        if let venue = context.state.venueName {
                            HStack(spacing: 3) {
                                Image(systemName: "mappin")
                                    .font(.system(size: 8))
                                    .foregroundColor(.white.opacity(0.5))
                                Text(venue)
                                    .font(.system(size: 11))
                                    .foregroundColor(.white.opacity(0.6))
                                    .lineLimit(1)
                            }
                        }
                    }
                }
                // Expanded trailing: date badge
                DynamicIslandExpandedRegion(.trailing) {
                    if let parts = dateParts(from: context.state.startAt) {
                        VStack(spacing: 0) {
                            Text(parts.day)
                                .font(.system(size: 16, weight: .bold, design: .rounded))
                                .foregroundColor(.white)
                            Text(parts.month)
                                .font(.system(size: 8, weight: .bold))
                                .foregroundColor(dvntPurple)
                        }
                        .frame(width: 36, height: 36)
                    }
                }
                // Expanded bottom: status row
                DynamicIslandExpandedRegion(.bottom) {
                    HStack(spacing: 8) {
                        if context.state.isLive {
                            HStack(spacing: 4) {
                                Circle().fill(dvntRed).frame(width: 5, height: 5)
                                Text("LIVE")
                                    .font(.system(size: 10, weight: .heavy))
                                    .foregroundColor(dvntRed)
                            }
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(dvntRed.opacity(0.15))
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        } else if context.state.isUpcoming, let cd = countdownString(from: context.state.startAt) {
                            HStack(spacing: 4) {
                                Image(systemName: "clock.fill")
                                    .font(.system(size: 8))
                                    .foregroundColor(dvntPurple)
                                Text(cd)
                                    .font(.system(size: 11, weight: .semibold))
                                    .foregroundColor(dvntPurple)
                            }
                            .padding(.horizontal, 8).padding(.vertical, 4)
                            .background(dvntPurple.opacity(0.15))
                            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                        }
                        Spacer()
                        if let icon = context.state.weatherIcon, let temp = context.state.weatherTempF {
                            HStack(spacing: 3) {
                                Image(systemName: weatherSFSymbol(icon))
                                    .font(.system(size: 9))
                                    .foregroundColor(dvntCyan)
                                Text("\(temp)°")
                                    .font(.system(size: 10, weight: .medium))
                                    .foregroundColor(.white.opacity(0.6))
                            }
                        }
                    }
                    .padding(.top, 4)
                }
            } compactLeading: {
                logoGlyphImage(size: 16)
            } compactTrailing: {
                if context.state.isLive {
                    HStack(spacing: 3) {
                        Circle().fill(dvntRed).frame(width: 5, height: 5)
                        Text("LIVE")
                            .font(.system(size: 12, weight: .heavy))
                            .foregroundColor(dvntRed)
                    }
                } else if context.state.isUpcoming, let cd = countdownString(from: context.state.startAt) {
                    Text(cd)
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundColor(dvntPurple)
                        .monospacedDigit()
                } else if let temp = context.state.weatherTempF {
                    Text("\(temp)°")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(dvntCyan)
                }
            } minimal: {
                logoGlyphImage(size: 14)
            }
            .widgetURL(URL(string: context.state.deepLink))
        }
    }
}
