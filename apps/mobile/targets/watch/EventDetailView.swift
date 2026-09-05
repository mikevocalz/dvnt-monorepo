import SwiftUI
import MapKit

struct EventDetailView: View {
    let eventId: String
    @Environment(EventStore.self) private var events
    @EnvironmentObject private var tickets: TicketStore

    var body: some View {
        Group {
            if let event = events.events.first(where: { $0.id == eventId }) {
                GeometryReader { geometry in
                    List {
                        DoorHeader(art: event.imageURL.map { .event(imageURL: $0, dominantHex: nil) } ?? .none,
                            title: event.title, stub: event.stateLabel.uppercased(), minimumHeight: geometry.size.height * 0.4)
                        if let group = tickets.groups.first(where: { $0.id == event.id }), group.hasPresentable {
                            NavigationLink { TicketStackView(group: group) } label: { Label("Show pass", systemImage: "qrcode") }
                        }
                        if let startsAt = event.startsAt {
                            VStack(alignment: .leading, spacing: DVNT.Space.hair) {
                                Text(eventTime(startsAt, zone: event.timeZone)).font(DVNT.TypeScale.body())
                                if let zone = event.timeZone, zone != TimeZone.current.identifier {
                                    Text("Your time: \(eventTime(startsAt, zone: nil))").font(DVNT.TypeScale.caption())
                                }
                            }.listRowBackground(Color.clear)
                        } else {
                            Text("Date to be confirmed").font(DVNT.TypeScale.body()).listRowBackground(Color.clear)
                        }
                        if let location = event.location {
                            Label(location, systemImage: event.isOnline ? "network" : "mappin")
                                .font(DVNT.TypeScale.body()).listRowBackground(Color.clear)
                        }
                        if let weather = event.weather {
                            VStack(alignment: .leading, spacing: DVNT.Space.tight) {
                                Text("\(weather.forecastAt == nil ? "Venue weather" : "Weather at doors") · \(String(format: "%.0f", weather.tempF))°F").font(DVNT.TypeScale.body())
                                if let label = weather.label { Text(label).font(DVNT.TypeScale.caption()) }
                                if let stamp = WatchEvent.date(weather.generatedAt) {
                                    Text("As of \(stamp.formatted(date: .abbreviated, time: .shortened))")
                                        .font(DVNT.TypeScale.caption()).foregroundStyle(DVNT.textDim)
                                }
                            }.listRowBackground(Color.clear)
                        }
                        eventMoments(event)
                        if event.status != "active" {
                            Label(event.stateLabel, systemImage: "exclamationmark.circle")
                                .foregroundStyle(DVNT.signal).listRowBackground(Color.clear)
                        }
                        if event.status == "active", event.section() != "Past" {
                            actions(event)
                        }
                        if let result = events.results[event.id], let message = result.message {
                            Label(message, systemImage: result.status == "confirmed" ? "checkmark.circle" : "exclamationmark.circle")
                                .font(DVNT.TypeScale.body()).listRowBackground(Color.clear)
                        }
                        if events.pending[event.id] != nil {
                            ProgressView("Confirming…").listRowBackground(Color.clear)
                        }
                        if !event.isOnline, let latitude = event.latitude, let longitude = event.longitude {
                            Button { openMaps(event, latitude: latitude, longitude: longitude) } label: { Label("Directions", systemImage: "arrow.turn.up.right") }
                        }
                        Button("Open on iPhone") { events.perform(eventId: event.id, action: "open_on_phone") }
                            .disabled(events.pending[event.id] != nil)
                        SnapshotFreshness(label: "Events", syncedAt: events.syncedAt).listRowBackground(Color.clear)
                        PhoneLinkStatus().listRowBackground(Color.clear)
                    }.listStyle(.plain)
                }
            } else {
                ContentUnavailableView("Event unavailable", systemImage: "calendar.badge.exclamationmark",
                    description: Text("Refresh events from your phone."))
            }
        }
        .navigationTitle("Event")
        .containerBackground(DVNT.canvas, for: .navigation)
        .privacySensitive()
    }

    @ViewBuilder private func eventMoments(_ event: WatchEvent) -> some View {
        if event.momentsStatus == "ready" {
            let moments = Array((event.moments ?? []).prefix(6))
            TimelineView(.explicit([Date()] + moments.map(\.cutoff))) { context in
                VStack(alignment: .leading, spacing: DVNT.Space.base) {
                    Text("Event moments").font(DVNT.TypeScale.body())
                    let visible = moments.filter { $0.cutoff > context.date }
                    if visible.isEmpty {
                        Text(moments.isEmpty ? "No published photos available" : "Photo access expired. Refresh while connected.")
                            .font(DVNT.TypeScale.caption())
                    }
                    ForEach(visible) { moment in
                        NavigationLink {
                            EventMomentDetail(eventId: event.id, momentId: moment.id)
                        } label: {
                            EventMomentImage(moment: moment, accountGen: events.envelope.accountGen)
                                .frame(height: 110).accessibilityLabel("Open event photo")
                        }.buttonStyle(.plain)
                    }
                }
            }.listRowBackground(Color.clear)
        } else if event.momentsStatus == "unavailable" {
            Text("Event photos unavailable. Reconnect and refresh.").font(DVNT.TypeScale.caption()).listRowBackground(Color.clear)
        }
        Button(event.momentsStatus == nil ? "View event moments" : "Refresh event moments") {
            events.perform(eventId: event.id, action: "load_moments")
        }.disabled(events.pending[event.id] != nil)
    }

    @ViewBuilder private func actions(_ event: WatchEvent) -> some View {
        if event.inviteStatus == "pending" {
            Text("Open this invitation on your iPhone to respond.").font(DVNT.TypeScale.body()).listRowBackground(Color.clear)
        } else {
            if !event.ticketingEnabled, event.rsvp != "going" {
                action("RSVP Going", "going", event)
            }
            if event.rsvp != "interested" { action("Interested", "interested", event) }
            if event.rsvp == "going" || event.rsvp == "interested" { action("Can’t go", "not_going", event) }
        }
        if event.canJoinWaitlist && event.waitlist.isEmpty { action("Join waitlist", "waitlist_join", event) }
        ForEach(Array(event.waitlist.enumerated()), id: \.offset) { _, entry in
            if entry.offerStatus == "offered" {
                let expired = WatchEvent.date(entry.offerExpiresAt).map { $0 <= Date() } ?? false
                Text(expired ? "Waitlist offer expired" : "A place is available. Claim it on your iPhone.")
                    .font(DVNT.TypeScale.body()).listRowBackground(Color.clear)
            }
            Button("Leave waitlist") { events.perform(eventId: event.id, action: "waitlist_leave", ticketTypeId: entry.ticketTypeId) }
                .disabled(events.pending[event.id] != nil)
        }
    }
    private func action(_ title: String, _ action: String, _ event: WatchEvent) -> some View {
        Button(title) { events.perform(eventId: event.id, action: action) }.disabled(events.pending[event.id] != nil)
    }
    private func eventTime(_ date: Date, zone: String?) -> String {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium; formatter.timeStyle = .short
        formatter.timeZone = zone.flatMap(TimeZone.init(identifier:)) ?? .current
        return formatter.string(from: date) + (zone.map { " · \($0)" } ?? "")
    }
    private func openMaps(_ event: WatchEvent, latitude: Double, longitude: Double) {
        let item = MKMapItem(placemark: MKPlacemark(coordinate: CLLocationCoordinate2D(latitude: latitude, longitude: longitude)))
        item.name = event.location ?? event.title
        item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking])
    }
}

/// Every render rechecks snapshot permission expiry, including a viewer already open.
private struct EventMomentDetail: View {
    let eventId: String
    let momentId: String
    @Environment(EventStore.self) private var events
    var body: some View {
        let moment = events.events.first { $0.id == eventId }?.moments?.first { $0.id == momentId }
        TimelineView(.explicit([Date(), moment?.cutoff ?? Date()])) { context in
            if let moment, moment.cutoff > context.date {
                EventMomentImage(moment: moment, accountGen: events.envelope.accountGen)
                    .padding(DVNT.Space.base)
            } else { ContentUnavailableView("Photo unavailable", systemImage: "photo", description: Text("Refresh event moments while connected.")) }
        }.navigationTitle("Event photo").privacySensitive()
    }
}
private struct EventMomentImage: View {
    let moment: WatchEventMoment
    let accountGen: String
    @Environment(EventStore.self) private var events
    @Environment(\.isLuminanceReduced) private var dimmed
    @State private var image: CGImage?
    @State private var failed = false
    var body: some View {
        Group {
            if dimmed || moment.cutoff <= Date() { Image(systemName: "photo").foregroundStyle(DVNT.textDim) }
            else if let image { Image(decorative: image, scale: 1).resizable().scaledToFit() }
            else if failed { Text("Photo unavailable. Refresh on your phone.").font(DVNT.TypeScale.caption()) }
            else { ProgressView("Loading photo") }
        }.privacySensitive().task(id: "\(accountGen)|\(moment.imageURL)|\(dimmed)") {
            image = nil; failed = false
            guard !dimmed, moment.cutoff > Date() else { return }
            do {
                let decoded = try await WatchMediaCache.shared.image(url: moment.imageURL, accountGen: accountGen, maximumPixels: 320)
                guard !Task.isCancelled, events.envelope.accountGen == accountGen, moment.cutoff > Date() else { return }
                image = decoded
            } catch { if !Task.isCancelled { failed = true } }
        }
    }
}
