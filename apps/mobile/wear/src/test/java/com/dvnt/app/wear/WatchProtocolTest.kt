package com.dvnt.app.wear

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class WatchProtocolTest {
    private fun message(id: Int, text: String = "Message $id") = ThreadMessage(id.toString(), "9", text, "7", false,
        "2026-09-05T12:00:00.123456Z", emptyList())

    @Test fun olderWindowRetainsRequestedPageAndCursor() {
        val previous = ThreadState((51..300).map { message(it) }, ThreadCursor("2026-09-05T12:00:00.123456Z", "51"))
        val cursor = ThreadCursor("2026-09-05T12:00:00.123456Z", "26")
        val merged = mergeThreadPage(previous, (26..50).map { message(it) }, cursor, true)
        assertEquals(250, merged.messages.size)
        assertEquals("26", merged.messages.first().id)
        assertEquals("275", merged.messages.last().id)
        assertEquals(cursor, merged.olderCursor)
    }

    @Test fun refreshBoundsWindowAndReplacesEditedRows() {
        val previous = ThreadState((1..250).map { message(it) }, null)
        val merged = mergeThreadPage(previous, (240..260).map { message(it, "edited") }, null, false)
        assertEquals(250, merged.messages.size)
        assertEquals("11", merged.messages.first().id)
        assertEquals("260", merged.messages.last().id)
        assertEquals("11", merged.olderCursor?.id)
        assertEquals("edited", merged.messages.single { it.id == "240" }.text)
        assertEquals(merged.messages.size, merged.messages.map { it.id }.toSet().size)
    }

    @Test fun persistentOperationRoundTripsWithoutChangingIdOrBody() {
        val entry = PendingMessage("12345678-1234-4234-8234-123456789abc", "account-a", "9", "On my way", 100, 200, "failed", "timeout")
        val decoded = PendingMessage.from(JSONObject(entry.json().toString()))
        assertEquals(entry, decoded)
        assertEquals(2, decoded.command().getInt("protocol"))
        assertEquals("dmReply", decoded.command().getString("type"))
        assertEquals(entry.operationId, decoded.command().getString("operationId"))
        assertFalse(decoded.command().has("status"))
    }

    @Test fun reactionStateUsesAuthoritativeMineAndCount() {
        val row = ThreadMessage.from(JSONObject("""{"id":"77","conversationId":"9","createdAt":"2026-09-05T12:00:00Z","reactions":[{"emoji":"❤️","count":2,"mine":true}]}"""))
        assertEquals(listOf(MessageReaction("❤️", 2, true)), row.reactions)
        assertEquals(emptyList<MessageAttachment>(), row.attachments)
    }

    @Test fun legacySummaryDefaultsToRequestsAndMissingAttachmentsStayEmpty() {
        val row = ConversationSummary.from(JSONObject("""{"id":"9","name":"Person"}"""))
        assertEquals("request", row.category)
        assertFalse(row.unread)
        assertTrue(row.attachments.isEmpty())
        assertNull(row.avatarURL)
    }
}
