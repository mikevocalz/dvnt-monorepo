package com.dvnt.app.wear

import org.json.JSONArray
import org.json.JSONObject

data class MessageAttachment(val id: String, val kind: String, val thumbURL: String?, val fullURL: String?, val alt: String?) {
    companion object {
        fun from(json: JSONObject) = MessageAttachment(json.optString("id"), json.optString("kind", "image"),
            json.optStringOrNull("thumbURL"), json.optStringOrNull("fullURL"), json.optStringOrNull("alt"))
    }
}
data class ConversationSummary(val id: String, val name: String, val preview: String, val timestamp: Long,
    val unread: Boolean, val category: String, val avatarURL: String?, val attachments: List<MessageAttachment>) {
    companion object {
        fun from(json: JSONObject) = ConversationSummary(json.getString("id"), json.optString("name", "DVNT"),
            json.optString("preview"), json.optLong("timestamp"), json.optBoolean("unread"),
            json.optString("category", "request"), json.optStringOrNull("avatarURL"), attachments(json.optJSONArray("attachments")))
    }
}
data class MessageReaction(val emoji: String, val count: Int, val mine: Boolean)

data class ThreadMessage(val id: String, val conversationId: String, val text: String, val senderId: String,
    val outgoing: Boolean, val createdAt: String, val attachments: List<MessageAttachment>, val reactions: List<MessageReaction> = emptyList(), val senderName: String? = null) {
    fun json(): JSONObject = JSONObject().put("id", id).put("conversationId", conversationId).put("text", text)
        .put("senderId", senderId).put("senderName", senderName).put("outgoing", outgoing).put("createdAt", createdAt)
        .put("attachments", JSONArray(attachments.map { JSONObject().put("id", it.id).put("kind", it.kind)
            .put("thumbURL", it.thumbURL).put("fullURL", it.fullURL).put("alt", it.alt) }))
        .put("reactions", JSONArray(reactions.map { JSONObject().put("emoji", it.emoji).put("count", it.count).put("mine", it.mine) }))
    companion object {
        fun from(json: JSONObject) = ThreadMessage(json.getString("id"), json.getString("conversationId"), json.optString("text"),
            json.optString("senderId"), json.optBoolean("outgoing"), json.getString("createdAt"), attachments(json.optJSONArray("attachments")),
            json.optJSONArray("reactions")?.let { rows ->
                (0 until rows.length()).mapNotNull { i ->
                    rows.optJSONObject(i)?.let { r -> MessageReaction(r.optString("emoji"), r.optInt("count"), r.optBoolean("mine")) }
                }
            } ?: emptyList(), json.optStringOrNull("senderName"))
    }
}
data class ThreadCursor(val createdAt: String, val id: String) {
    fun json() = JSONObject().put("createdAt", createdAt).put("id", id)
}
data class ThreadState(val messages: List<ThreadMessage> = emptyList(), val olderCursor: ThreadCursor? = null,
    val loading: Boolean = false, val error: String? = null)
data class PendingMessage(val operationId: String, val accountGen: String, val conversationId: String, val text: String,
    val issuedAt: Long, val expiresAt: Long, val status: String = "queued", val error: String? = null, val serverId: String? = null) {
    fun command() = JSONObject().put("protocol", 2).put("accountGen", accountGen).put("operationId", operationId)
        .put("type", "dmReply").put("conversationId", conversationId).put("text", text).put("issuedAt", issuedAt).put("expiresAt", expiresAt)
    fun json() = command().put("status", status).put("error", error).put("serverId", serverId)
    companion object {
        fun from(j: JSONObject) = PendingMessage(j.getString("operationId"), j.getString("accountGen"), j.getString("conversationId"),
            j.getString("text"), j.getLong("issuedAt"), j.getLong("expiresAt"), j.optString("status", "queued"), j.optStringOrNull("error"), j.optStringOrNull("serverId"))
    }
}
internal fun attachments(array: JSONArray?): List<MessageAttachment> = (0 until (array?.length() ?: 0)).mapNotNull { i ->
    array?.optJSONObject(i)?.let { MessageAttachment.from(it) }
}.take(6)

internal fun mergeThreadPage(previous: ThreadState, messages: List<ThreadMessage>, next: ThreadCursor?, older: Boolean, removed: Set<String> = emptySet()): ThreadState {
    val retained = previous.messages.filterNot { it.id in removed }
    val all = if (older) (messages + retained).distinctBy { it.id }
        else (retained.filterNot { old -> messages.any { it.id == old.id } } + messages)
            .sortedWith(compareBy<ThreadMessage> { parseIso8601(it.createdAt) ?: 0 }.thenBy { it.id.toLongOrNull() ?: 0 })
    val merged = if (older) all.take(250) else all.takeLast(250)
    val cursor = when {
        !older && all.size > 250 -> merged.firstOrNull()?.let { ThreadCursor(it.createdAt, it.id) }
        !older && previous.messages.isNotEmpty() -> previous.olderCursor
        else -> next
    }
    return ThreadState(merged, cursor, false)
}

/** Desired state survives uncertainty; retries never toggle a possibly applied reaction. */
data class PendingReaction(val accountGen: String, val conversationId: String, val messageId: String,
    val emoji: String, val desiredPresent: Boolean, val operationId: String = java.util.UUID.randomUUID().toString()) {
    val key: String get() = "$conversationId:$messageId:$emoji"
    fun json() = JSONObject().put("accountGen", accountGen).put("conversationId", conversationId)
        .put("messageId", messageId).put("emoji", emoji).put("desiredPresent", desiredPresent).put("operationId", operationId)
    fun command(now: Long) = json().put("protocol", 2).put("type", "threadAction").put("action", "reaction")
        .put("issuedAt", now).put("expiresAt", now + 60)
    companion object {
        fun from(j: JSONObject) = PendingReaction(j.getString("accountGen"), j.getString("conversationId"),
            j.getString("messageId"), j.getString("emoji"), j.getBoolean("desiredPresent"), j.getString("operationId"))
    }
}
