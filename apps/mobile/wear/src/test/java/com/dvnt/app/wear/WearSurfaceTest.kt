package com.dvnt.app.wear

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.time.Instant

class WearSurfaceTest {
    private val now = Instant.parse("2026-09-05T12:00:00Z").toEpochMilli()
    private fun ticket(status: String) = WatchTicket.from(JSONObject("""{"id":"1","eventId":"81","eventTitle":"Private title","status":"$status","eventDate":"2026-09-05T14:00:00Z","eventEndDate":"2026-09-05T18:00:00Z"}"""))
    private fun tickets(status: String, gen: String = "a") = WatchTicketEnvelope(listOf(ticket(status)), 100, null, 2, gen)
    private fun events() = EventsState(accountGen = "a", events = listOf(WatchEvent.from(JSONObject("""{"id":"82","title":"Private invite","status":"active","inviteStatus":"pending","startAt":"2026-09-05T15:00:00Z"}"""))))
    @Test fun unknownAndCancelledTicketStatusNeverPresentQrOrBecomeTilePass() {
        assertFalse(TicketStatus.from(null).isPresentable)
        assertFalse(TicketStatus.from("unrecognized").isPresentable)
        assertFalse(TicketStatus.from("cancelled").isPresentable)
        for (status in listOf("revoked", "expired", "checked_in", "cancelled", "unrecognized")) {
            val snap = surfaceSnapshot("a", InboxState(), tickets(status), events(), now)
            assertEquals("Events", snap.destination)
            assertEquals("82", snap.eventId)
        }
    }
    @Test fun validPassWinsAndWatchFaceSummaryContainsNoPrivateData() {
        val inbox = InboxState(accountGen = "a", conversations = listOf(ConversationSummary.from(JSONObject("""{"id":"1","name":"Secret name","preview":"Secret body","unread":true}"""))))
        val snap = surfaceSnapshot("a", inbox, tickets("valid"), events(), now)
        assertEquals("Tickets", snap.destination)
        assertEquals("81", snap.eventId)
        assertEquals("2h", snap.countdown(now))
        assertEquals(1, snap.unreadChats)
        assertFalse(snap.summary(now).contains("Secret"))
        assertFalse(snap.summary(now).contains("Private"))
    }
    @Test fun switchedAccountCannotExposeCachedCountsEventsOrTickets() {
        val snap = surfaceSnapshot("b", InboxState(accountGen = "a"), tickets("valid"), events(), now)
        assertNull(snap.nextAt)
        assertNull(snap.eventId)
        assertEquals("Inbox", snap.destination)
        assertEquals(0, snap.unreadChats)
        assertEquals("Open phone to sign in", surfaceSnapshot("", InboxState(), tickets("valid"), events(), now).summary(now))
    }
}
