package com.dvnt.app.wear

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.util.UUID

data class CallPerson(val id: String, val name: String, val avatarURL: String?) {
    companion object { fun from(j: JSONObject) = CallPerson(j.getString("id"), j.optString("name", "Person"), j.optStringOrNull("avatarURL")) }
}
data class CallRecent(val id: String, val people: List<CallPerson>, val createdAt: String, val direction: String, val status: String, val video: Boolean)
data class ActiveCompanionCall(val roomId: String?, val phase: String, val peerStatus: String, val name: String, val muted: Boolean, val canMute: Boolean, val expiresAt: Long, val syncedAt: Double) {
    fun isFresh(now: Long = System.currentTimeMillis() / 1000) = expiresAt > now && phase != "ended"
}
data class IncomingCompanionCall(val id: String, val name: String, val video: Boolean, val group: Boolean, val ringingSince: Long) {
    fun isFresh(now: Long = System.currentTimeMillis() / 1000) = ringingSince <= now + 5 && now < ringingSince + 30
}
data class CallsState(val accountGen: String = "", val people: List<CallPerson> = emptyList(), val recents: List<CallRecent> = emptyList(),
    val syncedAt: Double = 0.0, val active: ActiveCompanionCall? = null, val incoming: IncomingCompanionCall? = null,
    val pending: Boolean = false, val message: String? = null)

fun canRecoverNotificationAction(current: CallsState, incoming: IncomingCompanionCall?, expectedTarget: String?, expectedGeneration: String?, currentGeneration: String, ended: Set<String>, now: Long): Boolean =
    incoming != null && current.incoming == null && current.active?.isFresh(now) != true && incoming.id !in ended && incoming.isFresh(now) &&
        expectedTarget == incoming.id && !expectedGeneration.isNullOrBlank() && expectedGeneration == currentGeneration

class CallRepository private constructor(private val context: Context) {
    private val prefs = context.getSharedPreferences("dvnt.wear.calls", Context.MODE_PRIVATE)
    private val _state = MutableStateFlow(CallsState())
    val state = _state.asStateFlow()
    private val ended = mutableSetOf<String>()
    init { prefs.getString("directory", null)?.let { json ->
        val j = runCatching { JSONObject(json) }.getOrNull()
        if (j != null && WearAccountSession.matches(context, j.optString("accountGen"), j.optInt("protocol"))) ingestDirectory(json)
    } }
    private fun people(rows: JSONArray?): List<CallPerson> = if (rows == null) emptyList() else (0 until rows.length()).mapNotNull { runCatching { CallPerson.from(rows.getJSONObject(it)) }.getOrNull() }.take(30)
    fun ingestDirectory(json: String) { synchronized(WearAccountSession) {
        val j = runCatching { JSONObject(json) }.getOrNull() ?: return
        val gen = j.optString("accountGen"); val stamp = j.optDouble("syncedAt")
        if (j.optInt("protocol") != 2 || !stamp.isFinite() || !WearAccountSession.accept(context, gen, stamp.toLong()) || stamp < _state.value.syncedAt) return
        if (j.optStringOrNull("error") != null) {
            _state.value = _state.value.copy(accountGen = gen, message = j.optString("error"))
            return
        }
        val rows = j.optJSONArray("recents") ?: JSONArray()
        val recents = (0 until rows.length()).mapNotNull { i -> runCatching { val row = rows.getJSONObject(i)
            CallRecent(row.getString("id"), people(row.optJSONArray("people")), row.optString("createdAt"), row.optString("direction"), row.optString("status"), row.optBoolean("isVideo")) }.getOrNull() }.take(20)
        _state.value = _state.value.copy(accountGen = gen, people = people(j.optJSONArray("people")), recents = recents, syncedAt = stamp, message = j.optStringOrNull("error"))
        prefs.edit().putString("directory", json).commit()
    } }
    fun ingestActive(json: String) { synchronized(WearAccountSession) {
        val j = runCatching { JSONObject(json) }.getOrNull() ?: return
        val gen = j.optString("accountGen"); val stamp = j.optDouble("syncedAt")
        if (j.optInt("protocol") != 2 || gen != WearAccountSession.generation(context) || !stamp.isFinite() || stamp < (_state.value.active?.syncedAt ?: 0.0)) return
        val phase = j.optString("phase")
        if (phase !in listOf("connecting", "ringing", "connected", "reconnecting", "ended")) return
        val active = ActiveCompanionCall(j.optStringOrNull("roomId"), phase, j.optString("peerStatus"), j.optString("name", "Call"), j.optBoolean("muted"), j.optBoolean("canMute"), j.optLong("expiresAt"), stamp)
        _state.value = _state.value.copy(accountGen = gen, active = active, incoming = if (phase in listOf("connected", "ended")) null else _state.value.incoming)
        CallNotifications.update(context, _state.value)
    } }
    fun ingestLive(root: JSONObject) { synchronized(WearAccountSession) {
        if (!root.has("session")) return
        val j = root.optStringOrNull("call")?.let { runCatching { JSONObject(it) }.getOrNull() }
        if (j != null && j.optInt("protocol") == 2 && j.optString("accountGen") == WearAccountSession.generation(context)) {
            val call = IncomingCompanionCall(j.optString("id"), j.optString("callerName", "Incoming call"), j.optBoolean("isVideo"), j.optBoolean("isGroup"), j.optLong("ringingSince"))
            if (call.id.isNotBlank() && call.id !in ended && call.isFresh()) _state.value = _state.value.copy(accountGen = j.optString("accountGen"), incoming = call, message = null)
        }
        if (root.has("callEnded")) {
            val id = root.optString("callEnded")
            if (id.isNotBlank()) ended.add(id)
            if (id.isBlank() || _state.value.incoming?.id == id) _state.value = _state.value.copy(incoming = null, active = if (id.isBlank()) null else _state.value.active)
        }
        CallNotifications.update(context, _state.value)
    } }
    suspend fun refresh() {
        val gen = WearAccountSession.generation(context)
        try {
            val response = MessageRepository.get(context).request(JSONObject().put("type", "requestCallDirectory").put("protocol", 2).put("accountGen", gen))
            synchronized(WearAccountSession) {
                if (gen != WearAccountSession.generation(context)) return
                response.optStringOrNull("callDirectory")?.let { if (JSONObject(it).optString("accountGen") == gen) ingestDirectory(it) }
            }
        } catch (_: Exception) { publish(gen, "Phone unreachable. Open DVNT on your phone.") }
    }
    suspend fun command(type: String, action: String, ids: List<String> = emptyList(), video: Boolean = false, query: String? = null, expectedTarget: String? = null, expectedGeneration: String? = null, notificationIncoming: IncomingCompanionCall? = null, notificationOperationId: String? = null) {
        val gen: String; val snapshot: CallsState
        synchronized(WearAccountSession) {
            val current = _state.value
            val recover = type == "callAction" && canRecoverNotificationAction(current, notificationIncoming, expectedTarget,
                expectedGeneration, WearAccountSession.generation(context), ended, System.currentTimeMillis() / 1000)
            snapshot = if (recover) current.copy(accountGen = expectedGeneration!!, incoming = notificationIncoming) else current
            gen = snapshot.accountGen
            if (gen.isBlank() || gen != WearAccountSession.generation(context) || snapshot.pending) return
            if (expectedGeneration != null && gen != expectedGeneration) return
            if (expectedTarget != null && (type != "callAction" || snapshot.incoming?.id != expectedTarget || snapshot.incoming.isFresh() != true)) return
            _state.value = snapshot.copy(pending = true, message = null)
        }
        val op = notificationOperationId ?: UUID.randomUUID().toString(); val now = System.currentTimeMillis() / 1000
        val body = JSONObject().put("protocol", 2).put("accountGen", gen).put("operationId", op).put("type", type).put("action", action).put("issuedAt", now).put("expiresAt", now + 30)
        try {
            when (type) {
                "callDirectoryAction" -> if (action == "search") body.put("query", query) else {
                    require(ids.size in 1..3 && ids.distinct().size == ids.size)
                    body.put("participantIds", JSONArray(ids)).put("callType", if (video) "video" else "audio")
                }
                "activeCallAction" -> {
                    val active = snapshot.active ?: error("Call unavailable")
                    require(active.isFresh() && active.roomId != null)
                    body.put("roomId", active.roomId).put("expectedStatus", active.phase)
                    if (action == "set_muted") { require(active.canMute); body.put("muted", !active.muted) }
                }
                "callAction" -> {
                    val incoming = snapshot.incoming ?: error("Call expired")
                    require(incoming.isFresh())
                    body.put("callId", incoming.id).put("expectedStatus", "ringing").put("expiresAt", minOf(now + 30, incoming.ringingSince + 30))
                }
                else -> error("Unknown action")
            }
            val response = MessageRepository.get(context).request(body)
            synchronized(WearAccountSession) {
                if (gen != WearAccountSession.generation(context)) return
                if (type == "callAction") {
                    if (!response.optBoolean("ok")) error("Not confirmed")
                    snapshot.incoming?.id?.let { ended.add(it) }
                    _state.value = _state.value.copy(incoming = null)
                    publish(gen, if (action == "decline") "Decline sent to phone" else "Continue call on phone")
                } else {
                    val key = if (type == "activeCallAction") "activeCallResult" else "callDirectoryResult"
                    val result = JSONObject(response.getString(key))
                    require(result.optInt("protocol") == 2 && result.optString("accountGen") == gen && result.optString("operationId") == op)
                    if (type == "activeCallAction") require(result.optString("roomId") == snapshot.active?.roomId)
                    require(result.optString("status") in listOf("confirmed", "failed", "rejected"))
                    if (action == "search" && result.optString("status") == "confirmed") _state.value = _state.value.copy(people = people(result.optJSONArray("people")))
                    publish(gen, result.optString("message", if (result.optString("status") == "confirmed") "Confirmed on phone" else "Not confirmed. Check phone."))
                }
            }
        } catch (_: Exception) { publish(gen, "Result not confirmed. Check your phone before trying again.") }
    }
    private fun publish(gen: String, message: String) { synchronized(WearAccountSession) {
        if (gen == WearAccountSession.generation(context)) {
            _state.value = _state.value.copy(pending = false, message = message)
            CallNotifications.update(context, _state.value)
        }
    } }
    private fun clearAccount() { _state.value = CallsState(); ended.clear(); prefs.edit().clear().commit(); CallNotifications.clear(context) }
    companion object {
        @Volatile private var instance: CallRepository? = null
        fun get(context: Context) = instance ?: synchronized(WearAccountSession) { instance ?: CallRepository(context.applicationContext).also { instance = it } }
        fun clearForAccountSwitch() { instance?.clearAccount() }
    }
}
