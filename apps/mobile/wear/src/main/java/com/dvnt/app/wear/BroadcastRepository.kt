package com.dvnt.app.wear

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONObject

data class HostBroadcast(val id: String, val eventId: String, val eventTitle: String, val host: String,
    val body: String, val createdAt: Long, val read: Boolean, val imageURL: String?) {
    companion object {
        fun from(row: JSONObject): HostBroadcast? {
            val id = row.optString("id")
            val event = row.optString("eventId")
            val body = row.optString("body")
            val stamp = row.optDouble("createdAt")
            if (id.isBlank() || event.isBlank() || body.isBlank() || body.length > 10000 || !stamp.isFinite() || stamp <= 0) return null
            return HostBroadcast(id, event, row.optString("eventTitle", "Event"), row.optString("host", "Host"),
                body, stamp.toLong(), row.optBoolean("read"), row.optStringOrNull("eventImageURL")?.takeIf { it.startsWith("https://") })
        }
    }
}
data class BroadcastState(val accountGen: String = "", val syncedAt: Long = 0, val broadcasts: List<HostBroadcast> = emptyList())

/** Only recipient-scoped activity entries are mirrored; the wrist never infers audiences. */
class BroadcastRepository private constructor(private val context: Context) {
    private val prefs = context.getSharedPreferences("dvnt.wear.broadcasts", Context.MODE_PRIVATE)
    private val _state = MutableStateFlow(BroadcastState())
    val state = _state.asStateFlow()
    init { prefs.getString("envelope", null)?.let { raw ->
        val envelope = runCatching { JSONObject(raw) }.getOrNull()
        if (envelope != null && WearAccountSession.matches(context, envelope.optString("accountGen"), envelope.optInt("protocol"))) ingest(raw)
    } }
    fun ingest(raw: String) { synchronized(WearAccountSession) {
        val envelope = runCatching { JSONObject(raw) }.getOrNull() ?: return
        val account = envelope.optString("accountGen")
        val stamp = envelope.optDouble("syncedAt").takeIf { it.isFinite() && it > 0 }?.toLong() ?: return
        if (envelope.optInt("protocol") != 2 || !WearAccountSession.accept(context, account, stamp)) return
        if (_state.value.accountGen == account && stamp < _state.value.syncedAt) return
        val rows = envelope.optJSONArray("broadcasts") ?: return
        val parsed = (0 until rows.length()).mapNotNull { rows.optJSONObject(it)?.let(HostBroadcast::from) }
            .distinctBy { it.id }.sortedByDescending { it.createdAt }.take(40)
        _state.value = BroadcastState(account, stamp, parsed)
        prefs.edit().putString("envelope", raw).commit()
    } }
    private fun clear() { _state.value = BroadcastState(); prefs.edit().clear().commit() }
    companion object {
        @Volatile private var instance: BroadcastRepository? = null
        fun get(context: Context): BroadcastRepository = instance ?: synchronized(WearAccountSession) {
            instance ?: BroadcastRepository(context.applicationContext).also { instance = it }
        }
        fun clearForAccountSwitch() { instance?.clear() }
    }
}
