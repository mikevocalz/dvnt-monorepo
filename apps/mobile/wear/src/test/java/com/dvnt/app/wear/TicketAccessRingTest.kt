package com.dvnt.app.wear

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class TicketAccessRingTest {
    private fun ticket(id: String = "1", status: String = "valid", owner: Boolean? = true): WatchTicket = WatchTicket.from(JSONObject()
        .put("id", id).put("status", status).put("eventDate", "2026-09-05T20:00:00Z")
        .put("eventEndDate", "2026-09-06T04:00:00Z").put("isOwner", owner))
    private val doors = parseIso8601("2026-09-05T20:00:00Z")!!

    @Test fun exactDoorAndEndBoundariesMatchApplePhases() {
        val pass = ticket()
        assertEquals("scheduled", pass.ringState(doors - 86_400_001).phase)
        assertEquals(0f, pass.ringState(doors - 86_400_000).fraction)
        assertEquals(.5f, pass.ringState(doors - 43_200_000).fraction)
        assertEquals("open", pass.ringState(doors).phase)
        assertEquals("blocked", pass.ringState(doors + 28_800_000).phase)
        assertEquals("admitted", ticket(status = "checked_in").ringState(doors).phase)
        assertEquals("admitted", ticket(status = "scanned").ringState(doors).phase)
        for (status in listOf("revoked", "cancelled", "expired", "transfer_pending", "unknown")) {
            assertTrue(ticket(status = status).ringState(doors).blocked)
            assertFalse(ticket(status = status).status.isPresentable)
        }
    }
    @Test fun malformedOrUnboundedQrCannotAllocateOrRender() {
        assertNull(WatchQrMatrix(Int.MAX_VALUE, "0").modules)
        assertNull(WatchQrMatrix(22, "0".repeat(200)).modules)
        assertNull(WatchQrMatrix(45, "0").modules)
        assertNull(WatchQrMatrix(45, "0".repeat(508)).modules)
        assertNull(WatchQrMatrix(45, "x".repeat(507)).modules)
        assertEquals(2025, WatchQrMatrix(45, "0".repeat(507)).modules?.size)
    }

    @Test fun samePassSurvivesReorderAndRemovalSelectsAvailablePass() {
        val first = ticket("1"); val second = ticket("2")
        assertEquals("2", selectedTicket(listOf(first, second), "2")?.id)
        assertEquals("2", selectedTicket(listOf(second, first), "2")?.id)
        assertEquals("1", selectedTicket(listOf(first), "2")?.id)
        assertNull(selectedTicket(emptyList(), "2"))
    }
    @Test fun membershipPerksRequireExplicitOwnerAndResolvedPhoneMembership() {
        val membership = WatchMembership("VIP", true, true, true, true, true, true)
        assertEquals(membership, ticket(owner = true).ownerMembership(membership))
        assertNull(ticket(owner = false).ownerMembership(membership))
        assertNull(ticket(owner = null).ownerMembership(membership))
        assertNull(ticket(owner = true).ownerMembership(null))
        val malformed = WatchTicket.from(JSONObject().put("id", "x").put("isOwner", "true"))
        assertNull(malformed.ownerMembership(membership))
    }
}
