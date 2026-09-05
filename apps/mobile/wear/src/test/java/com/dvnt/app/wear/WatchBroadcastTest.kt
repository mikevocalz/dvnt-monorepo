package com.dvnt.app.wear

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WatchBroadcastTest {
    @Test fun hostWordsRemainVerbatimAndImagesRequireHttps() {
        val row = JSONObject("""{"id":"notice-1","eventId":"8","eventTitle":"Tonight","host":"Host","body":"Entrance moved.\nUse the left door.","createdAt":1788610000,"read":false,"eventImageURL":"https://cdn.example.com/event.jpg"}""")
        val notice = HostBroadcast.from(row)!!
        assertEquals("Entrance moved.\nUse the left door.", notice.body)
        assertFalse(notice.read)
        assertEquals("https://cdn.example.com/event.jpg", notice.imageURL)
        row.put("eventImageURL", "http://cdn.example.com/event.jpg")
        assertNull(HostBroadcast.from(row)!!.imageURL)
    }
    @Test fun missingIdentityBodyOrCanonicalTimestampDoesNotProduceNotice() {
        assertNull(HostBroadcast.from(JSONObject("""{"id":"1","eventId":"8","body":"Hello","createdAt":"yesterday"}""")))
        assertNull(HostBroadcast.from(JSONObject("""{"id":"1","body":"Hello","createdAt":1788610000}""")))
        assertNull(HostBroadcast.from(JSONObject("""{"id":"1","eventId":"8","body":" ","createdAt":1788610000}""")))
    }
}
