package com.dvnt.app.wear

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/** Shared account fence for every Data Layer domain; no credentials cross this boundary. */
object WearAccountSession {
    private fun prefs(context: Context) = context.getSharedPreferences("dvnt.wear.session", Context.MODE_PRIVATE)
    fun generation(context: Context): String = prefs(context).getString("generation", "") ?: ""

    @Synchronized fun accept(context: Context, generation: String, rawStamp: Long): Boolean {
        val stamp = if (rawStamp > 100_000_000_000L) rawStamp / 1000 else rawStamp
        if (stamp <= 0) return false
        val prefs = prefs(context)
        val previous = prefs.getString("generation", "") ?: ""
        val previousStamp = prefs.getLong("syncedAt", 0)
        val retired = runCatching { JSONArray(prefs.getString("retired", "[]")) }.getOrDefault(JSONArray())
        if (generation.isNotEmpty() && (0 until retired.length()).any { retired.optString(it) == generation }) return false
        if (generation != previous && stamp < previousStamp) return false
        if (generation != previous) {
            if (previous.isNotEmpty()) retired.put(previous)
            if (!prefs.edit().putString("generation", generation).putLong("syncedAt", stamp)
                    .putString("retired", retired.toString()).commit()) return false
            MessageRepository.clearForAccountSwitch()
            TicketRepository.clearForAccountSwitch()
            EventRepository.clearForAccountSwitch()
            BroadcastRepository.clearForAccountSwitch()
            context.getSharedPreferences("dvnt.wear.broadcasts", Context.MODE_PRIVATE).edit().clear().commit()
            DoorRepository.clearForAccountSwitch()
            context.getSharedPreferences("dvnt.wear.door", Context.MODE_PRIVATE).edit().clear().commit()
            CallRepository.clearForAccountSwitch()
            com.dvnt.app.wear.ui.clearMessageImages(context)
            CallNotifications.clear(context)
            WearSurfaces.requestUpdate(context)
        } else prefs.edit().putLong("syncedAt", maxOf(stamp, previousStamp)).apply()
        return true
    }

    fun acceptContext(context: Context, root: JSONObject): Boolean {
        val session = when (val raw = root.opt("session")) {
            is JSONObject -> raw
            is String -> runCatching { JSONObject(raw) }.getOrNull()
            else -> return true // Legacy contexts still validate each versioned envelope.
        } ?: return false
        return session.optInt("protocol") == 2 && accept(context, session.optString("accountGen"), session.optLong("syncedAt"))
    }

    fun matches(context: Context, generation: String?, protocol: Int?): Boolean {
        val current = generation(context)
        return if (protocol == 2) generation == current else current.isEmpty()
    }
}
