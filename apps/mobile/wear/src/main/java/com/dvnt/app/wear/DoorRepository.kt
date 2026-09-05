package com.dvnt.app.wear

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject
import java.util.UUID

/** Only validated aggregates cross the door boundary; no guest roster is cached. */
data class WatchDoor(val eventId: String, val eventTitle: String, val expected: Long, val arrived: Long,
    val remaining: Long, val priorityLane: Long, val approaching: Long) {
    companion object {
        fun from(json: JSONObject): WatchDoor? {
            val id = json.optString("eventId")
            if (!id.matches(Regex("[1-9][0-9]*")) || json.opt("eventTitle") !is String) return null
            fun count(key: String): Long? {
                val number = json.opt(key) as? Number ?: return null
                val value = number.toDouble()
                return if (value.isFinite() && value >= 0 && value <= 9_007_199_254_740_991.0 && value == value.toLong().toDouble()) value.toLong() else null
            }
            val expected = count("expected") ?: return null
            val arrived = count("arrived") ?: return null
            val remaining = count("remaining") ?: return null
            val priority = count("priorityLane") ?: return null
            val approaching = count("approaching") ?: return null
            if (arrived > expected || remaining != expected - arrived || priority > remaining || approaching > remaining) return null
            return WatchDoor(id, json.getString("eventTitle"), expected, arrived, remaining, priority, approaching)
        }
    }
}
data class DoorState(val accountGen: String = "", val door: WatchDoor? = null, val syncedAt: Long = 0,
    val error: String? = null, val loading: Boolean = false, val pending: Boolean = false, val result: String? = null,
    val uncertain: Boolean = false)

class DoorRepository private constructor(private val context: Context) {
    private val prefs = context.getSharedPreferences("dvnt.wear.door", Context.MODE_PRIVATE)
    private val mutable = MutableStateFlow(DoorState())
    val state = mutable.asStateFlow()
    init {
        prefs.getString("envelope", null)?.let { raw ->
            val json = runCatching { JSONObject(raw) }.getOrNull()
            if (json != null && WearAccountSession.matches(context, json.optString("accountGen"), json.optInt("protocol"))) ingest(raw)
        }
        if (prefs.getBoolean("uncertain", false)) mutable.value = mutable.value.copy(uncertain = true, result = "Notice not confirmed. Check the host dashboard on your phone before sending again.")
    }
    fun ingest(raw: String) { synchronized(WearAccountSession) {
        val json = runCatching { JSONObject(raw) }.getOrNull() ?: return
        if (json.optInt("protocol") != 2) return
        val generation = json.optString("accountGen")
        val stamp = json.optDouble("syncedAt").takeIf { it.isFinite() && it > 0 }?.toLong() ?: return
        if (!WearAccountSession.accept(context, generation, stamp)) return
        if (mutable.value.accountGen == generation && stamp < mutable.value.syncedAt) return
        if (json.optString("status") == "error") {
            mutable.value = mutable.value.copy(accountGen = generation, loading = false, error = "Couldn’t refresh door counts. Cached counts may be out of date.")
            return
        }
        if (json.optString("status") != "ready") return
        val door = if (json.isNull("door")) null else WatchDoor.from(json.optJSONObject("door") ?: return) ?: return
        mutable.value = mutable.value.copy(accountGen = generation, door = door, syncedAt = stamp, loading = false, error = null)
        prefs.edit().putString("envelope", raw).commit()
    } }
    suspend fun refresh() {
        val account = WearAccountSession.generation(context)
        mutable.value = mutable.value.copy(loading = true)
        try {
            val response = MessageRepository.get(context).request(JSONObject().put("type", "requestDoor").put("protocol", 2).put("accountGen", account))
            synchronized(WearAccountSession) {
                if (WearAccountSession.generation(context) != account) return
                if (!WearAccountSession.acceptContext(context, response)) return
                response.optStringOrNull("door")?.let { ingest(it) }
                mutable.value = mutable.value.copy(loading = false)
            }
        } catch (_: Exception) { synchronized(WearAccountSession) {
            if (WearAccountSession.generation(context) == account) mutable.value = mutable.value.copy(loading = false, error = "Phone unreachable. Open DVNT on your phone and retry.")
        } }
    }
    suspend fun sendNotice(body: String) {
        val current = synchronized(WearAccountSession) {
            val current = mutable.value
            if (current.door == null || current.pending || current.uncertain || current.accountGen.isBlank() ||
                current.accountGen != WearAccountSession.generation(context) || body.isBlank() || body.length > 400) return
            // A killed process must never turn an uncertain broadcast into an automatic replay.
            if (!prefs.edit().putBoolean("uncertain", true).commit()) {
                mutable.value = current.copy(result = "Could not save this request. Try on your phone."); return
            }
            mutable.value = current.copy(pending = true, result = null)
            current
        }
        val operation = UUID.randomUUID().toString()
        val now = System.currentTimeMillis() / 1000
        var confirmed = false
        var rejected = false
        try {
            val wire = MessageRepository.get(context).request(JSONObject().put("protocol", 2).put("accountGen", current.accountGen)
                .put("operationId", operation).put("type", "venueAction").put("action", "notice").put("eventId", current.door!!.eventId)
                .put("body", body.trim()).put("audience", "all").put("issuedAt", now).put("expiresAt", now + 30))
            val result = wire.optStringOrNull("venueResult")?.let { JSONObject(it) } ?: error("No result")
            if (result.optInt("protocol") != 2 || result.optString("accountGen") != current.accountGen ||
                result.optString("operationId") != operation || result.optString("eventId") != current.door.eventId) error("Unconfirmed result")
            confirmed = result.optString("status") == "confirmed"
            rejected = result.optString("status") == "rejected"
        } catch (_: Exception) { /* Preserve uncertain status across relaunch. */ }
        synchronized(WearAccountSession) {
            if (WearAccountSession.generation(context) != current.accountGen) return
            prefs.edit().putBoolean("uncertain", !confirmed && !rejected).commit()
            mutable.value = mutable.value.copy(pending = false, uncertain = !confirmed && !rejected,
                result = if (confirmed) "Notice sent" else if (rejected) "Notice rejected. Check your permission on the phone."
                    else "Notice not confirmed. Check the host dashboard on your phone before sending again.")
        }
    }
    private fun clear() { mutable.value = DoorState(); prefs.edit().clear().commit() }
    companion object {
        @Volatile private var instance: DoorRepository? = null
        fun get(context: Context) = instance ?: synchronized(WearAccountSession) { instance ?: DoorRepository(context.applicationContext).also { instance = it } }
        fun clearForAccountSwitch() { instance?.clear() }
    }
}
