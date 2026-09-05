package com.dvnt.app.wear

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WatchDoorTest {
    private fun fixture() = JSONObject("""{"eventId":"12","eventTitle":"Tonight","expected":20,"arrived":8,"remaining":12,"priorityLane":3,"approaching":4}""")
    @Test fun acceptsOnlyConsistentAggregateCounts() {
        assertEquals(12L, WatchDoor.from(fixture())!!.remaining)
        assertNull(WatchDoor.from(fixture().put("remaining", 11)))
        assertNull(WatchDoor.from(fixture().put("priorityLane", 13)))
        assertNull(WatchDoor.from(fixture().put("approaching", 13)))
        assertNull(WatchDoor.from(fixture().put("arrived", 21)))
    }
    @Test fun absentInvalidOrFractionalCountsNeverBecomeZero() {
        for (key in listOf("expected", "arrived", "remaining", "priorityLane", "approaching")) {
            assertNull(WatchDoor.from(fixture().apply { remove(key) }))
            assertNull(WatchDoor.from(fixture().put(key, -1)))
            assertNull(WatchDoor.from(fixture().put(key, 0.5)))
            assertNull(WatchDoor.from(fixture().put(key, "3")))
        }
        assertNull(WatchDoor.from(fixture().put("eventId", "0")))
        assertNull(WatchDoor.from(fixture().put("eventTitle", JSONObject.NULL)))
    }
}
