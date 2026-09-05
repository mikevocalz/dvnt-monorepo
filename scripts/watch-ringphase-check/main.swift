// Boundary check for RingPhase — the one piece of real logic in the watch target.
// Compiled for the host (RingPhase.swift + Models.swift + TicketStore.swift import
// only Foundation/Combine) and RUN, because the watch binary is arm64_32 and cannot
// execute here. See scripts/verify-watch.mjs, which drives this.
//
// What it protects: a pass that flips to `.blocked` an hour early strands a paying
// member at a door, and a `.approaching` fraction outside 0…1 silently draws a
// wrong or inverted arc.
import Foundation

private var failures = 0

private func expect(_ cond: Bool, _ what: String) {
    if !cond {
        failures += 1
        FileHandle.standardError.write(Data("FAIL: \(what)\n".utf8))
    }
}

private let iso: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f
}()

private func ticket(
    status: String = "valid",
    doorsIn hours: Double? = 2,
    lasting duration: Double = 6
) -> WatchTicket {
    let now = Date()
    var json: [String: Any] = [
        "id": "t1", "eventId": "e1", "qrToken": "abc", "status": status,
        "eventTitle": "Test",
    ]
    if let hours {
        let doors = now.addingTimeInterval(hours * 3600)
        json["eventDate"] = iso.string(from: doors)
        json["eventEndDate"] = iso.string(from: doors.addingTimeInterval(duration * 3600))
    }
    let data = try! JSONSerialization.data(withJSONObject: json)
    return try! JSONDecoder().decode(WatchTicket.self, from: data)
}

// A dead ticket is dead regardless of the clock.
expect(RingPhase.of(ticket(status: "revoked")) == .blocked, "revoked → blocked")
expect(RingPhase.of(ticket(status: "expired")) == .blocked, "expired → blocked")
expect(RingPhase.of(ticket(status: "checked_in")) == .admitted, "checked_in → admitted")
expect(RingPhase.of(ticket(status: "scanned")) == .admitted, "scanned → admitted")

// Admitted must win over blocked: someone scanned in at a show that has since
// ended should still see "checked in", not "not valid".
expect(RingPhase.of(ticket(status: "checked_in", doorsIn: -48)) == .admitted,
       "checked in at a finished event stays admitted")

// Beyond the 24h horizon there is no countdown to draw.
expect(RingPhase.of(ticket(doorsIn: 48)) == .scheduled, "48h out → scheduled")
expect(RingPhase.of(ticket(doorsIn: nil)) == .scheduled, "no date → scheduled")

// Inside the horizon the arc fills toward doors, monotonically, in 0…1.
for (hoursOut, lower, upper) in [(23.5, 0.0, 0.05), (12.0, 0.45, 0.55), (0.25, 0.98, 1.0)] {
    guard case .approaching(let p) = RingPhase.of(ticket(doorsIn: hoursOut)) else {
        expect(false, "\(hoursOut)h out → approaching")
        continue
    }
    expect(p >= lower && p <= upper, "\(hoursOut)h out → progress \(p) in \(lower)…\(upper)")
}

// The door boundary, from both sides.
expect(RingPhase.of(ticket(doorsIn: -0.01)) == .open, "just past doors → open")
expect(RingPhase.of(ticket(doorsIn: -5, lasting: 6)) == .open, "mid-event → open")

// After the event ends, a still-`valid` row stops presenting.
expect(RingPhase.of(ticket(doorsIn: -7, lasting: 6)) == .blocked, "past end → blocked")

// Blocked is the only phase without an arc; every other fraction is drawable.
for phase in [RingPhase.open, .admitted, .scheduled, .approaching(progress: 0.3)] {
    guard let f = phase.fraction else {
        expect(false, "\(phase) should have a fraction")
        continue
    }
    expect(f >= 0 && f <= 1, "\(phase) fraction \(f) in 0…1")
}
expect(RingPhase.blocked.fraction == nil, "blocked has no arc")

// Out-of-range input must be clamped, not drawn as a >full or negative arc.
expect(RingPhase.approaching(progress: 1.4).fraction == 1, "clamps above 1")
expect(RingPhase.approaching(progress: -0.4).fraction == 0, "clamps below 0")

// Only a pass that can still admit someone earns an animation loop.
expect(RingPhase.open.animates && RingPhase.approaching(progress: 0.5).animates,
       "live phases animate")
expect(!RingPhase.admitted.animates && !RingPhase.blocked.animates
       && !RingPhase.scheduled.animates, "settled phases do not animate")

if failures > 0 {
    FileHandle.standardError.write(Data("\nRingPhase: \(failures) failure(s)\n".utf8))
    exit(1)
}
print("watch RingPhase OK — door/expiry boundaries and arc clamping hold")
