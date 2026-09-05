package com.dvnt.app.wear

import android.content.Context
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext
import kotlinx.coroutines.withTimeout
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

data class InboxState(val accountGen: String = "", val conversations: List<ConversationSummary> = emptyList(),
    val quickReplies: List<String> = emptyList(), val syncedAt: Long = 0, val signedIn: Boolean = false, val error: String? = null)

class MessageRepository private constructor(private val context: Context) {
    private val prefs = context.getSharedPreferences("dvnt.wear.messages", Context.MODE_PRIVATE)
    private val _inbox = MutableStateFlow(InboxState())
    val inbox = _inbox.asStateFlow()
    private val _threads = MutableStateFlow<Map<String, ThreadState>>(emptyMap())
    val threads = _threads.asStateFlow()
    private val _outbox = MutableStateFlow<List<PendingMessage>>(emptyList())
    val outbox = _outbox.asStateFlow()
    private val _reactions = MutableStateFlow<List<PendingReaction>>(emptyList())
    val reactions = _reactions.asStateFlow()
    private val reactionFlights = mutableSetOf<String>()
    private val pending = ConcurrentHashMap<String, Pair<String, CompletableDeferred<JSONObject>>>()

    private var restoring = true

    init {
        prefs.getString("context", null)?.let { ingest(it) }
        val saved = runCatching { JSONArray(prefs.getString("outbox", "[]")) }.getOrDefault(JSONArray())
        _outbox.value = (0 until saved.length()).mapNotNull { i -> runCatching { PendingMessage.from(saved.getJSONObject(i)) }.getOrNull() }
            .filter { it.accountGen == _inbox.value.accountGen && allowedConversation(it.conversationId) }.map { if (it.status == "sending") it.copy(status = "failed", error = "Delivery not confirmed. Retry safely.") else it }
        val reactionRows = runCatching { JSONArray(prefs.getString("reactions", "[]")) }.getOrDefault(JSONArray())
        _reactions.value = (0 until reactionRows.length()).mapNotNull { runCatching { PendingReaction.from(reactionRows.getJSONObject(it)) }.getOrNull() }
            .filter { it.accountGen == _inbox.value.accountGen && allowedConversation(it.conversationId) }.take(50)
        val cachedThreads = runCatching { JSONObject(prefs.getString("threads", "{}") ?: "{}") }.getOrDefault(JSONObject())
        if (cachedThreads.optString("accountGen") == _inbox.value.accountGen) {
            val pages = cachedThreads.optJSONObject("pages") ?: JSONObject()
            _threads.value = pages.keys().asSequence().filter { allowedConversation(it) }.take(8).mapNotNull { id ->
                runCatching {
                    val page = pages.getJSONObject(id)
                    val rows = page.getJSONArray("messages")
                    id to ThreadState((0 until minOf(rows.length(), 250)).map { ThreadMessage.from(rows.getJSONObject(it)) },
                        page.optJSONObject("olderCursor")?.let { ThreadCursor(it.getString("createdAt"), it.getString("id")) })
                }.getOrNull()
            }.toMap()
        }
        restoring = false
    }

    fun ingest(json: String) { synchronized(WearAccountSession) { synchronized(this) {
        val root = runCatching { JSONObject(json) }.getOrNull() ?: return
        if (!WearAccountSession.acceptContext(context, root)) return
        fun scopedPayload(key: String): String? {
            val json = root.optStringOrNull(key) ?: return null
            if (root.has("session")) {
                val generation = runCatching { JSONObject(json).optString("accountGen") }.getOrNull()
                if (generation != WearAccountSession.generation(context)) return null
            }
            return json
        }
        scopedPayload("payload")?.let { TicketRepository.get(context).ingest(it) }
        scopedPayload("door")?.let { DoorRepository.get(context).ingest(it) }
        scopedPayload("broadcasts")?.let { BroadcastRepository.get(context).ingest(it) }
        scopedPayload("events")?.let { EventRepository.get(context).ingest(it) }
        scopedPayload("callDirectory")?.let { CallRepository.get(context).ingestDirectory(it) }
        scopedPayload("activeCall")?.let { CallRepository.get(context).ingestActive(it) }
        CallRepository.get(context).ingestLive(root)
        scopedPayload("threadPage")?.let { json ->
            val page = runCatching { JSONObject(json) }.getOrNull()
            if (page != null && page.optInt("protocol") == 2 && page.optString("accountGen") == _inbox.value.accountGen) {
                val id = page.optString("conversationId")
                if (allowedConversation(id)) {
                    val messages = page.optJSONArray("messages")
                    if (messages != null) {
                        val rows = (0 until messages.length()).mapNotNull { runCatching { ThreadMessage.from(messages.getJSONObject(it)) }.getOrNull() }
                        val cursor = page.optJSONObject("olderCursor")?.let { ThreadCursor(it.optString("createdAt"), it.optString("id")) }
                        thread(id) { mergeThreadPage(it, rows, cursor, false, removedIds(page)) }
                    }
                }
            }
        }
        val envelope = when (val nested = root.opt("dms")) {
            is JSONObject -> nested
            is String -> runCatching { JSONObject(nested) }.getOrNull()
            else -> if (root.has("dms")) root else null
        } ?: return
        if (envelope.optInt("protocol") != 2) return
        val generation = envelope.optString("accountGen")
        val stamp = envelope.optLong("syncedAt")
        if (root.has("session") && generation != WearAccountSession.generation(context)) return
        if (!WearAccountSession.accept(context, generation, stamp)) return
        if (generation == _inbox.value.accountGen && stamp < _inbox.value.syncedAt) return
        if (generation != _inbox.value.accountGen && !restoring) clearAccount()
        if (envelope.optString("status") == "error") {
            _inbox.value = _inbox.value.copy(error = envelope.optString("error", "Could not refresh messages. Cached messages remain available."))
            return
        }
        val rows = envelope.optJSONArray("dms") ?: JSONArray()
        val summaries = (0 until rows.length()).mapNotNull { i -> runCatching { ConversationSummary.from(rows.getJSONObject(i)) }.getOrNull() }.take(30)
        val allowed = summaries.map { it.id }.toSet()
        synchronized(this) {
            val removed = _inbox.value.conversations.any { it.id !in allowed }
            _threads.value = _threads.value.filterKeys { it in allowed }
            _outbox.value = _outbox.value.filter { it.conversationId in allowed }
            _reactions.value = _reactions.value.filter { it.conversationId in allowed }
            if (!restoring) saveReactions()
            if (removed || allowed.isEmpty()) com.dvnt.app.wear.ui.clearMessageImages(context)
            if (!restoring) { saveOutbox(); saveThreads() }
            prefs.all.keys.filter { it.startsWith("draft:") && it.removePrefix("draft:") !in allowed }.forEach { prefs.edit().remove(it).apply() }
        }
        val replies = envelope.optJSONArray("quickReplies") ?: JSONArray()
        _inbox.value = InboxState(generation,
            summaries,
            (0 until replies.length()).map { replies.optString(it) }.filter { it.isNotBlank() }.take(8), stamp, generation.isNotBlank())
        prefs.edit().putString("context", json).commit()
        WearSurfaces.requestUpdate(context)
    } } }

    @Synchronized private fun clearAccount() {
        _inbox.value = InboxState()
        _threads.value = emptyMap()
        _outbox.value = emptyList()
        _reactions.value = emptyList()
        reactionFlights.clear()
        com.dvnt.app.wear.ui.clearMessageImages(context)
        pending.values.forEach { it.second.cancel() }
        pending.clear()
        prefs.edit().clear().commit()
    }

    fun ingest(events: DataEventBuffer) {
        for (event in events) if (event.type == DataEvent.TYPE_CHANGED && event.dataItem.uri.path == "/dvnt/context") {
            DataMapItem.fromDataItem(event.dataItem).dataMap.getString("payload")?.let { ingest(it) }
        }
    }

    suspend fun hydrate() = withContext(Dispatchers.IO) {
        runCatching {
            val items = Tasks.await(Wearable.getDataClient(context).dataItems)
            try { for (item in items) if (item.uri.path == "/dvnt/context") DataMapItem.fromDataItem(item).dataMap.getString("payload")?.let { ingest(it) } }
            finally { items.release() }
        }
        Unit
    }

    fun receive(event: MessageEvent) {
        if (event.path.startsWith("/dvnt/event/") && event.data.size <= 90_000) {
            ingest(event.data.toString(Charsets.UTF_8))
            return
        }
        if (!event.path.startsWith("/dvnt/response/") || event.data.size > 90_000) return
        val id = event.path.removePrefix("/dvnt/response/")
        val waiter = pending[id] ?: return
        if (waiter.first != event.sourceNodeId) return
        val response = runCatching { JSONObject(event.data.toString(Charsets.UTF_8)) }.getOrNull() ?: return
        waiter.second.complete(response)
    }

    internal suspend fun request(body: JSONObject): JSONObject = withContext(Dispatchers.IO) {
        val node = PhoneLink.phoneNodeId(context) ?: error("Phone unreachable. Open DVNT on your phone and retry.")
        val id = UUID.randomUUID().toString()
        val deferred = CompletableDeferred<JSONObject>()
        pending[id] = node to deferred
        try {
            Tasks.await(Wearable.getMessageClient(context).sendMessage(node, "/dvnt/command/$id", body.toString().toByteArray(Charsets.UTF_8)))
            withTimeout(20_000) { deferred.await() }
        } finally { pending.remove(id) }
    }

    private fun removedIds(page: JSONObject): Set<String> {
        val rows = page.optJSONArray("removedMessageIds") ?: return emptySet()
        if (rows.length() > 0) com.dvnt.app.wear.ui.clearMessageImages(context)
        return (0 until minOf(rows.length(), 250)).map { rows.optString(it) }.toSet()
    }

    private fun allowedConversation(id: String) = _inbox.value.conversations.any { it.id == id }

    @Synchronized private fun thread(id: String, transform: (ThreadState) -> ThreadState) {
        if (!allowedConversation(id)) return
        _threads.value = (_threads.value - id).entries.toList().takeLast(7).associate { it.toPair() } + (id to transform(_threads.value[id] ?: ThreadState()))
        saveThreads()
    }

    private fun saveThreads() {
        val pages = JSONObject()
        _threads.value.forEach { (id, state) -> pages.put(id, JSONObject()
            .put("messages", JSONArray(state.messages.map { it.json() })).put("olderCursor", state.olderCursor?.json())) }
        prefs.edit().putString("threads", JSONObject().put("accountGen", _inbox.value.accountGen).put("pages", pages).toString()).commit()
    }

    suspend fun loadThread(id: String, older: Boolean = false) {
        val account = _inbox.value.accountGen
        if (account.isBlank() || !allowedConversation(id) || _threads.value[id]?.loading == true) return
        val cursor = if (older) _threads.value[id]?.olderCursor ?: return else null
        thread(id) { it.copy(loading = true, error = null) }
        try {
            val body = JSONObject().put("protocol", 2).put("accountGen", account).put("type", "threadPage").put("conversationId", id)
            body.put("retainedMessageIds", JSONArray(_threads.value[id]?.messages?.map { it.id } ?: emptyList<String>()))
            cursor?.let { body.put("olderCursor", it.json()) }
            val wire = request(body)
            val response = wire.optStringOrNull("threadPage")?.let { JSONObject(it) } ?: wire
            if (_inbox.value.accountGen != account) return
            if (response.optInt("protocol") != 2 || response.optString("accountGen") != account || response.optString("conversationId") != id) error(response.optString("error", "Could not load this conversation"))
            val rows = response.optJSONArray("messages") ?: error(response.optString("error", "Could not load messages"))
            val messages = (0 until rows.length()).map { ThreadMessage.from(rows.getJSONObject(it)) }
            val next = response.optJSONObject("olderCursor")?.let { ThreadCursor(it.getString("createdAt"), it.getString("id")) }
            thread(id) { previous ->
                mergeThreadPage(previous, messages, next, older, removedIds(response))
            }
        } catch (e: Exception) {
            if (_inbox.value.accountGen == account) thread(id) { it.copy(loading = false, error = e.message ?: "Phone did not respond. Retry.") }
        }
    }

    private fun saveReactions() = prefs.edit().putString("reactions", JSONArray(_reactions.value.map { it.json() }).toString()).commit()

    @Synchronized fun cancelReaction(key: String) {
        if (key in reactionFlights) return
        _reactions.value = _reactions.value.filterNot { it.key == key }; saveReactions()
    }

    suspend fun react(conversationId: String, messageId: String, emoji: String, desiredPresent: Boolean): String? {
        val account = _inbox.value.accountGen
        if (account.isBlank() || !allowedConversation(conversationId) || emoji !in listOf("😂", "😢", "😊", "😈", "🥵", "💝", "❤️")) return "Reaction unavailable"
        val intent = PendingReaction(account, conversationId, messageId, emoji, desiredPresent)
        synchronized(this) {
            if (intent.key in reactionFlights) return "Updating…"
            val old = _reactions.value
            val existing = old.firstOrNull { it.key == intent.key }
            if (existing != null && existing.desiredPresent != desiredPresent) return "Retry or cancel the pending reaction first."
            if (existing == null) {
                if (old.size >= 50) return "Retry or cancel queued reactions first."
                _reactions.value = old + intent
                if (!saveReactions()) { _reactions.value = old; return "Could not save reaction. Retry." }
            }
        }
        return retryReaction(intent.key)
    }

    suspend fun retryReaction(key: String): String? {
        val intent = synchronized(this) {
            val item = _reactions.value.firstOrNull { it.key == key } ?: return null
            if (item.accountGen != _inbox.value.accountGen || !allowedConversation(item.conversationId)) return "Account changed"
            if (!reactionFlights.add(key)) return "Updating…"
            item
        }
        return try {
            val response = request(intent.command(System.currentTimeMillis() / 1000))
            synchronized(this) {
                if (_inbox.value.accountGen != intent.accountGen) return "Account changed"
                if (!response.optBoolean("ok")) return response.optString("error", "Could not update reaction. Retry.")
                _reactions.value = _reactions.value.filterNot { it.operationId == intent.operationId }
                saveReactions()
            }
            loadThread(intent.conversationId)
            null
        } catch (_: Exception) { "Phone did not confirm the reaction. Retry safely." }
        finally { synchronized(this) { reactionFlights.remove(key) } }
    }

    fun draft(id: String): String = prefs.getString("draft:$id", "") ?: ""
    @Synchronized fun setDraft(id: String, text: String) { if (!allowedConversation(id)) return; prefs.edit().putString("draft:$id", text.take(500)).commit() }

    @Synchronized fun queue(id: String, text: String): String? {
        val generation = _inbox.value.accountGen
        if (generation.isBlank() || !allowedConversation(id) || text.isBlank() || text.length > 500 || _outbox.value.count { it.status != "sent" } >= 30) return null
        val now = System.currentTimeMillis() / 1000
        val entry = PendingMessage(UUID.randomUUID().toString(), generation, id, text.trim(), now, now + 86400)
        val previous = _outbox.value
        _outbox.value = (previous + entry).takeLast(50)
        if (!saveOutbox()) { _outbox.value = previous; return null }
        setDraft(id, "")
        return entry.operationId
    }

    @Synchronized private fun update(id: String, transform: (PendingMessage) -> PendingMessage) {
        _outbox.value = _outbox.value.map { if (it.operationId == id) transform(it) else it }
        saveOutbox()
    }
    @Synchronized fun cancel(id: String) {
        _outbox.value = _outbox.value.filterNot { it.operationId == id && it.status == "queued" }
        saveOutbox()
    }
    private fun saveOutbox(): Boolean = prefs.edit().putString("outbox", JSONArray(_outbox.value.map { it.json() }).toString()).commit()

    @Synchronized private fun claimSend(id: String): PendingMessage? {
        val entry = _outbox.value.firstOrNull { it.operationId == id } ?: return null
        if (entry.status == "sending" || entry.status == "sent" || entry.accountGen != _inbox.value.accountGen || !allowedConversation(entry.conversationId)) return null
        if (entry.expiresAt <= System.currentTimeMillis() / 1000) {
            update(id) { it.copy(status = "failed", error = "Reply expired. Start a new reply.") }
            return null
        }
        val previous = _outbox.value
        _outbox.value = previous.map { if (it.operationId == id) it.copy(status = "sending", error = null) else it }
        if (!saveOutbox()) { _outbox.value = previous; return null }
        return entry
    }

    suspend fun send(id: String) {
        val entry = claimSend(id) ?: return
        try {
            val wire = request(entry.command())
            val response = wire.optStringOrNull("commandResult")?.let { JSONObject(it) } ?: wire
            if (response.optInt("protocol") != 2 || response.optString("accountGen") != entry.accountGen || response.optString("operationId") != id) error("Delivery not confirmed. Retry safely.")
            if (_inbox.value.accountGen != entry.accountGen) return
            if (response.optString("status") == "sent" && response.optString("serverId").isNotBlank()) {
                update(id) { it.copy(status = "sent", serverId = response.getString("serverId")) }
                loadThread(entry.conversationId)
            } else update(id) { it.copy(status = "failed", error = response.optString("error", "Not sent. Retry.")) }
        } catch (_: Exception) { update(id) { it.copy(status = "failed", error = "Delivery not confirmed. Open DVNT on phone, then retry.") } }
    }

    companion object {
        @Volatile private var instance: MessageRepository? = null
        fun clearForAccountSwitch() { instance?.clearAccount() }
        fun get(context: Context): MessageRepository = instance ?: synchronized(WearAccountSession) {
            instance ?: MessageRepository(context.applicationContext).also { instance = it }
        }
    }
}
