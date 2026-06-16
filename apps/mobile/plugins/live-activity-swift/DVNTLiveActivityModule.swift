import ActivityKit
import Foundation
import React
import UIKit

private let APP_GROUP = "group.com.dvnt.app"

@objc(DVNTLiveActivity)
@available(iOS 16.2, *)
class DVNTLiveActivityModule: NSObject {

    @objc static func requiresMainQueueSetup() -> Bool { return false }

    @objc func areLiveActivitiesEnabled(_ resolve: @escaping RCTPromiseResolveBlock,
                                         rejecter reject: @escaping RCTPromiseRejectBlock) {
        if #available(iOS 16.2, *) {
            resolve(ActivityAuthorizationInfo().areActivitiesEnabled)
        } else {
            resolve(false)
        }
    }

    @objc func updateLiveActivity(_ jsonPayload: String) {
        guard #available(iOS 16.2, *) else { return }
        guard let data = jsonPayload.data(using: .utf8),
              let payload = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            print("[DVNTLiveActivity] Failed to parse payload JSON")
            return
        }
        let existingActivities = Activity<DVNTLiveAttributes>.activities
        Task {
            let heroPath = await downloadHeroImage(payload: payload)
            let state = buildContentState(from: payload, heroLocalPath: heroPath)
            if let existing = existingActivities.first {
                await existing.update(ActivityContent(state: state, staleDate: Date().addingTimeInterval(3600)))
                print("[DVNTLiveActivity] Updated existing activity")
            } else {
                do {
                    let attributes = DVNTLiveAttributes()
                    let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(3600))
                    let _ = try Activity<DVNTLiveAttributes>.request(attributes: attributes, content: content, pushType: .token)
                    print("[DVNTLiveActivity] Started new activity")
                } catch {
                    print("[DVNTLiveActivity] Failed to start activity: \(error)")
                }
            }
            persistToUserDefaults(payload: payload, heroLocalPath: heroPath)
        }
    }

    @objc func endLiveActivity() {
        guard #available(iOS 16.2, *) else { return }
        Task {
            for activity in Activity<DVNTLiveAttributes>.activities {
                await activity.end(nil, dismissalPolicy: .immediate)
            }
            print("[DVNTLiveActivity] Ended all activities")
        }
    }

    // ── Private Helpers ──

    private func persistToUserDefaults(payload: [String: Any], heroLocalPath: String?) {
        guard let defaults = UserDefaults(suiteName: APP_GROUP) else { return }
        var augmented = payload
        if var tile1 = augmented["tile1"] as? [String: Any] {
            tile1["heroLocalPath"] = heroLocalPath
            augmented["tile1"] = tile1
        }
        if let jsonData = try? JSONSerialization.data(withJSONObject: augmented),
           let json = String(data: jsonData, encoding: .utf8) {
            defaults.set(json, forKey: "surfacePayload")
            defaults.synchronize()
        }
    }

    private func downloadHeroImage(payload: [String: Any]) async -> String? {
        guard let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: APP_GROUP) else {
            print("[DVNTLiveActivity] App Group container nil")
            return nil
        }
        let thumbsDir = container.appendingPathComponent("la_thumbs", isDirectory: true)
        try? FileManager.default.createDirectory(at: thumbsDir, withIntermediateDirectories: true)

        let tile1 = payload["tile1"] as? [String: Any] ?? [:]
        guard let urlStr = tile1["heroThumbUrl"] as? String, !urlStr.isEmpty,
              let heroUrl = URL(string: urlStr) else {
            print("[DVNTLiveActivity] No hero URL")
            return nil
        }
        do {
            let (data, _) = try await URLSession.shared.data(from: heroUrl)
            guard UIImage(data: data) != nil else {
                print("[DVNTLiveActivity] Invalid hero image data")
                return nil
            }
            let fileURL = thumbsDir.appendingPathComponent("hero.png")
            try data.write(to: fileURL, options: .atomic)
            print("[DVNTLiveActivity] Hero downloaded (\(data.count)B)")
            return "la_thumbs/hero.png"
        } catch {
            print("[DVNTLiveActivity] Hero download failed: \(error.localizedDescription)")
            return nil
        }
    }

    private func buildContentState(from payload: [String: Any], heroLocalPath: String?) -> DVNTLiveAttributes.ContentState {
        let tile1 = payload["tile1"] as? [String: Any] ?? [:]
        let tile3 = payload["tile3"] as? [String: Any] ?? [:]
        let weather = payload["weather"] as? [String: Any]
        let tile3Items = tile3["items"] as? [[String: Any]] ?? []

        // Derive isLive: event started but within 8h window
        let isUpcoming = tile1["isUpcoming"] as? Bool ?? false
        var isLive = false
        if !isUpcoming, let startAt = tile1["startAt"] as? String,
           let startDate = ISO8601DateFormatter().date(from: startAt) {
            let elapsed = Date().timeIntervalSince(startDate)
            isLive = elapsed >= 0 && elapsed < 8 * 3600
        }

        return DVNTLiveAttributes.ContentState(
            eventId: tile1["eventId"] as? String,
            title: tile1["title"] as? String ?? "DVNT",
            startAt: tile1["startAt"] as? String,
            venueName: tile1["venueName"] as? String,
            city: tile1["city"] as? String,
            category: tile1["category"] as? String,
            heroLocalPath: heroLocalPath,
            isUpcoming: isUpcoming,
            isLive: isLive,
            deepLink: tile1["deepLink"] as? String ?? "https://dvntlive.app/events",
            attendeeCount: tile1["attendeeCount"] as? Int,
            upcomingTitles: tile3Items.map { $0["title"] as? String ?? "" },
            upcomingStartAts: tile3Items.map { $0["startAt"] as? String ?? "" },
            upcomingVenueNames: tile3Items.map { $0["venueName"] as? String ?? "" },
            upcomingDeepLinks: tile3Items.map { $0["deepLink"] as? String ?? "" },
            weatherIcon: weather?["icon"] as? String,
            weatherTempF: weather?["tempF"] as? Int,
            weatherLabel: weather?["label"] as? String
        )
    }
}
