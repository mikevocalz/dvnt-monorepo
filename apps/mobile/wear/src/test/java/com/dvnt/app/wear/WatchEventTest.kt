package com.dvnt.app.wear

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class WatchEventTest {
    private fun at(value: String) = Instant.parse(value).toEpochMilli()
    @Test fun ongoingOvernightEventRemainsTonightAcrossDstChange() {
        val event = WatchEvent.from(JSONObject("""{"id":"81","title":"Late set","status":"active","timeZone":"America/New_York","startAt":"2026-11-01T03:00:00Z","endAt":"2026-11-01T08:00:00Z"}"""))
        assertEquals("Tonight", event.section(at("2026-11-01T06:30:00Z")))
        assertEquals("Past", event.section(at("2026-11-01T08:00:00Z")))
    }
    @Test fun sectionUsesEventCalendarDateInsteadOfUtcDate() {
        val event = WatchEvent.from(JSONObject("""{"id":"82","status":"active","timeZone":"America/Los_Angeles","startAt":"2026-09-06T05:00:00Z","rsvp":"going"}"""))
        assertEquals("Tonight", event.section(at("2026-09-05T20:00:00Z")))
        assertEquals("Past", event.section(at("2026-09-06T20:00:00Z")))
    }
    @Test fun weatherRequiresFiniteTemperatureAndTimestamp() {
        val valid = WatchEvent.from(JSONObject("""{"id":"84","weather":{"tempF":72.5,"label":"Cloudy","generatedAt":"2026-09-05T12:00:00Z","precipPct":20}}"""))
        assertEquals(72.5, valid.weather!!.tempF, 0.01)
        assertEquals("2026-09-05T12:00:00Z", valid.weather!!.generatedAt)
        val invalid = WatchEvent.from(JSONObject("""{"id":"84","weather":{"tempF":72.5,"generatedAt":"Yesterday"}}"""))
        assertNull(invalid.weather)
    }
    @Test fun unavailableOptionalFieldsDoNotInventLocationOrFreeAdmission() {
        val event = WatchEvent.from(JSONObject("""{"id":"83","latitude":null,"longitude":"invalid","waitlist":[{"ticketTypeId":"abc","offerStatus":"offered","offerExpiresAt":"2026-09-05T20:00:00Z"}]}"""))
        assertNull(event.latitude)
        assertNull(event.longitude)
        assertTrue(event.ticketingEnabled)
        assertFalse(event.canJoinWaitlist)
        assertEquals("Status unavailable", event.stateLabel)
        assertEquals("abc", event.waitlist.single().ticketTypeId)
        assertEquals("offered", event.waitlist.single().offerStatus)
    }
}
