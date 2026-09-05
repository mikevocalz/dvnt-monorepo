package com.dvnt.app.wear
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class WatchEventMomentTest {
    @Test fun nativeCutoffUsesEarlierPermissionLease() {
        val moment = EventMoment.from(JSONObject("""{"id":"1","imageURL":"https://cdn.example.com/photo.jpg","expiresAt":"2026-09-06T12:00:00Z","visibleUntil":"2026-09-05T12:05:00Z"}"""))!!
        assertEquals(Instant.parse("2026-09-05T12:05:00Z").toEpochMilli(),moment.cutoff)
    }
    @Test fun malformedPermissionDatesFailClosed() {
        assertNull(EventMoment.from(JSONObject("""{"id":"1","imageURL":"https://cdn.example.com/photo.jpg","expiresAt":"tomorrow","visibleUntil":"2026-09-05T12:05:00Z"}""")))
    }
}
