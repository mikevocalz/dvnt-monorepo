import ActivityKit
import Foundation

@available(iOS 16.1, *)
struct DVNTLiveAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable {
        // Featured event
        var eventId: String?
        var title: String
        var startAt: String?
        var venueName: String?
        var city: String?
        var category: String?
        var heroLocalPath: String?
        var isUpcoming: Bool
        var isLive: Bool
        var deepLink: String
        var attendeeCount: Int?

        // Upcoming events (up to 3, for large widget / expanded views)
        var upcomingTitles: [String]
        var upcomingStartAts: [String]
        var upcomingVenueNames: [String]
        var upcomingDeepLinks: [String]

        // Weather
        var weatherIcon: String?
        var weatherTempF: Int?
        var weatherLabel: String?
    }
}
