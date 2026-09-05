package com.dvnt.app.wear

import android.content.Context
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.ZoneId
import java.util.UUID

data class WatchEventWeather(val tempF: Double, val label: String?, val generatedAt: String, val precipPct: Double?)
data class WatchEventWaitlist(val ticketTypeId: String?, val offerStatus: String, val offerExpiresAt: String?)
data class WatchEvent(val id: String, val title: String, val startAt: String?, val endAt: String?, val timeZone: String?,
    val imageURL: String?, val location: String?, val latitude: Double?, val longitude: Double?, val isOnline: Boolean,
    val status: String, val ticketingEnabled: Boolean, val rsvp: String?, val inviteStatus: String?, val saved: Boolean,
    val host: Boolean, val waitlist: List<WatchEventWaitlist>, val canJoinWaitlist: Boolean, val weather: WatchEventWeather? = null) {
    val stateLabel: String get() = when {
        status == "cancelled" -> "Cancelled"
        status == "postponed" -> "Postponed"
        status != "active" -> "Status unavailable"
        inviteStatus == "pending" -> "Invitation"
        waitlist.isNotEmpty() -> "On waitlist"
        rsvp == "going" -> "Going"
        rsvp == "interested" -> "Interested"
        rsvp == "not_going" -> "Not going"
        host -> "Hosting"
        saved -> "Saved"
        else -> "Event"
    }
    fun section(now: Long = System.currentTimeMillis()): String {
        val zone = runCatching { ZoneId.of(timeZone) }.getOrDefault(ZoneId.systemDefault())
        val start = parseIso8601(startAt)
        val end = parseIso8601(endAt)
        val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
        val day = start?.let { Instant.ofEpochMilli(it).atZone(zone).toLocalDate() }
        return when {
            end != null && end <= now -> "Past"
            end == null && day != null && day < today -> "Past"
            start != null && start <= now && end != null && end > now -> "Tonight"
            day == today -> "Tonight"
            inviteStatus == "pending" -> "Invitations"
            waitlist.isNotEmpty() -> "Waitlist"
            rsvp == "going" -> "Going"
            rsvp == "interested" -> "Interested"
            host -> "Hosting"
            else -> "Saved"
        }
    }
    companion object {
        fun from(j: JSONObject): WatchEvent {
            val list = j.optJSONArray("waitlist") ?: JSONArray()
            fun number(name: String) = if (j.has(name) && !j.isNull(name)) j.optDouble(name).takeIf { it.isFinite() } else null
            return WatchEvent(j.getString("id"), j.optString("title", "Event"), j.optStringOrNull("startAt"), j.optStringOrNull("endAt"),
                j.optStringOrNull("timeZone"), j.optStringOrNull("imageURL"), j.optStringOrNull("location"), number("latitude"), number("longitude"),
                j.optBoolean("isOnline"), j.optString("status", "unknown"), j.optBoolean("ticketingEnabled", true), j.optStringOrNull("rsvp"),
                j.optStringOrNull("inviteStatus"), j.optBoolean("saved"), j.optBoolean("host"),
                (0 until list.length()).mapNotNull { i -> list.optJSONObject(i)?.let { WatchEventWaitlist(it.optStringOrNull("ticketTypeId"), it.optString("offerStatus", "none"), it.optStringOrNull("offerExpiresAt")) } },
                j.optBoolean("canJoinWaitlist"), j.optJSONObject("weather")?.let { weather ->
                    val temp = weather.optDouble("tempF")
                    val stamp = weather.optString("generatedAt")
                    if (!temp.isFinite() || parseIso8601(stamp) == null) null else WatchEventWeather(temp, weather.optStringOrNull("label"), stamp,
                        weather.optDouble("precipPct").takeIf { it.isFinite() && it in 0.0..100.0 })
                })
        }
    }
}
data class EventActionResult(val status: String, val message: String)
data class EventsState(val accountGen: String = "", val events: List<WatchEvent> = emptyList(), val syncedAt: Long = 0,
    val error: String? = null, val loading: Boolean = false, val pending: Set<String> = emptySet(), val results: Map<String, EventActionResult> = emptyMap())

class EventRepository private constructor(private val context: Context) {
    private val prefs = context.getSharedPreferences("dvnt.wear.events", Context.MODE_PRIVATE)
    private val _state = MutableStateFlow(EventsState())
    val state = _state.asStateFlow()
    init {
        prefs.getString("envelope", null)?.let { json ->
            val envelope = runCatching { JSONObject(json) }.getOrNull()
            if (envelope != null && WearAccountSession.matches(context, envelope.optString("accountGen"), envelope.optInt("protocol"))) ingest(json)
        }
        val uncertain = prefs.getStringSet("pending", emptySet()) ?: emptySet()
        _state.value = _state.value.copy(results = uncertain.associateWith { EventActionResult("failed", "Result not confirmed. Check this event on your phone.") })
    }
    fun ingest(json: String) { synchronized(WearAccountSession) {
        val next = runCatching { JSONObject(json) }.getOrNull() ?: return
        if (next.optInt("protocol") != 2) return
        val account = next.optString("accountGen")
        val stamp = next.optDouble("syncedAt").takeIf { it.isFinite() && it > 0 }?.toLong() ?: return
        if (!WearAccountSession.accept(context, account, stamp)) return
        if (_state.value.accountGen == account && stamp < _state.value.syncedAt) return
        if (next.optString("status") == "error") {
            _state.value = _state.value.copy(error = next.optString("error", "Could not refresh events. Cached events remain available."), loading = false)
            return
        }
        if (next.optString("status") != "ready") return
        val rows = next.optJSONArray("events") ?: return
        val events = (0 until rows.length()).mapNotNull { i -> runCatching { WatchEvent.from(rows.getJSONObject(i)) }.getOrNull() }.take(60)
        _state.value = _state.value.copy(accountGen = account, events = events, syncedAt = stamp, error = null, loading = false)
        prefs.edit().putString("envelope", json).commit()
        WearSurfaces.requestUpdate(context)
    } }
    private fun clearAccount() {
        _state.value = EventsState()
        prefs.edit().clear().commit()
    }
    suspend fun refresh() {
        val account = synchronized(WearAccountSession) {
            _state.value = _state.value.copy(loading = true, error = null)
            WearAccountSession.generation(context)
        }
        try {
            val response = MessageRepository.get(context).request(JSONObject().put("type", "requestEvents").put("protocol", 2).put("accountGen", account))
            synchronized(WearAccountSession) {
                if (WearAccountSession.generation(context) != account) return
                if (!WearAccountSession.acceptContext(context, response)) return
                response.optStringOrNull("events")?.let {
                    val envelope = JSONObject(it)
                    if (envelope.optString("accountGen") == WearAccountSession.generation(context)) ingest(it)
                }
                _state.value = _state.value.copy(loading = false)
            }
        } catch (_: Exception) {
            synchronized(WearAccountSession) {
                if (WearAccountSession.generation(context) == account) _state.value = _state.value.copy(loading = false, error = "Phone unreachable. Open DVNT on your phone and retry.")
            }
        }
    }
    suspend fun perform(eventId: String, action: String, ticketTypeId: String? = null) {
        val account = synchronized(WearAccountSession) {
            val account = _state.value.accountGen
            if (account.isBlank() || WearAccountSession.generation(context) != account || eventId in _state.value.pending || _state.value.events.none { it.id == eventId }) return
            _state.value = _state.value.copy(pending = _state.value.pending + eventId, results = _state.value.results - eventId)
            if (!prefs.edit().putStringSet("pending", _state.value.pending).commit()) {
                finish(account, eventId, EventActionResult("failed", "Could not save this request. Check on your phone.")); return
            }
            account
        }
        val operation = UUID.randomUUID().toString()
        val now = System.currentTimeMillis() / 1000
        try {
            val body = JSONObject().put("protocol", 2).put("accountGen", account).put("operationId", operation).put("type", "eventAction")
                .put("eventId", eventId).put("action", action).put("issuedAt", now).put("expiresAt", now + 30)
            ticketTypeId?.let { body.put("ticketTypeId", it) }
            val wire = MessageRepository.get(context).request(body)
            if (WearAccountSession.generation(context) != account) return
            val result = wire.optStringOrNull("eventResult")?.let { JSONObject(it) } ?: error("No result")
            if (result.optInt("protocol") != 2 || result.optString("accountGen") != account || result.optString("operationId") != operation || result.optString("eventId") != eventId) error("Unconfirmed result")
            val status = result.optString("status")
            if (status !in listOf("confirmed", "failed", "rejected")) error("Unconfirmed result")
            finish(account, eventId, EventActionResult(status, result.optString("message", if (status == "confirmed") "Confirmed" else "Not confirmed. Check on your phone.")))
            if (status == "confirmed") refresh()
        } catch (_: Exception) {
            if (WearAccountSession.generation(context) == account) finish(account, eventId, EventActionResult("failed", "Result not confirmed. Check this event on your phone."))
        }
    }
    private fun finish(account: String, id: String, result: EventActionResult) { synchronized(WearAccountSession) {
        if (WearAccountSession.generation(context) != account || _state.value.accountGen != account) return
        _state.value = _state.value.copy(pending = _state.value.pending - id, results = _state.value.results + (id to result))
        // Uncertain writes stay recorded across relaunch; they are never automatically replayed.
        val unresolved = _state.value.pending + _state.value.results.filterValues { it.status == "failed" }.keys
        prefs.edit().putStringSet("pending", unresolved).commit()
    } }
    companion object {
        @Volatile private var instance: EventRepository? = null
        fun get(context: Context) = instance ?: synchronized(WearAccountSession) { instance ?: EventRepository(context.applicationContext).also { instance = it } }
        fun clearForAccountSwitch() { instance?.clearAccount() }
    }
}
