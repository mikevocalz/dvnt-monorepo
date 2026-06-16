package com.dvnt.app

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

class LiveSurfaceReceiver : BroadcastReceiver() {
    companion object {
        const val ACTION_PREV = "com.dvnt.app.LIVE_SURFACE_PREV"
        const val ACTION_NEXT = "com.dvnt.app.LIVE_SURFACE_NEXT"
        const val ACTION_DISMISS = "com.dvnt.app.LIVE_SURFACE_DISMISS"
        const val PREF_NAME = "dvnt_live_surface"
        const val KEY_TILE_INDEX = "current_tile_index"
    }

    override fun onReceive(context: Context, intent: Intent) {
        val prefs = context.getSharedPreferences(PREF_NAME, Context.MODE_PRIVATE)
        val currentTile = prefs.getInt(KEY_TILE_INDEX, 0)

        when (intent.action) {
            ACTION_PREV -> {
                val newTile = if (currentTile > 0) currentTile - 1 else 2
                prefs.edit().putInt(KEY_TILE_INDEX, newTile).apply()
            }
            ACTION_NEXT -> {
                val newTile = if (currentTile < 2) currentTile + 1 else 0
                prefs.edit().putInt(KEY_TILE_INDEX, newTile).apply()
            }
            ACTION_DISMISS -> {
                val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager
                nm.cancel(DVNTLiveNotificationModule.NOTIFICATION_ID)
                return
            }
        }

        try {
            val payloadJson = prefs.getString("payload_json", null)
            if (payloadJson != null) {
                DVNTLiveNotificationModule.showNotification(context, payloadJson)
            }
        } catch (e: Exception) {
            android.util.Log.e("LiveSurfaceReceiver", "Failed to refresh notification", e)
        }
    }
}
