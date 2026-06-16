package com.dvnt.app

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.widget.RemoteViews
import androidx.core.app.NotificationCompat
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject

class DVNTLiveNotificationModule(reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = "DVNTLiveNotification"

    companion object {
        const val CHANNEL_ID = "dvnt_live_surface"
        const val NOTIFICATION_ID = 9001

        fun showNotification(context: Context, jsonPayload: String) {
            val prefs = context.getSharedPreferences(LiveSurfaceReceiver.PREF_NAME, Context.MODE_PRIVATE)
            prefs.edit().putString("payload_json", jsonPayload).apply()
            val currentTile = prefs.getInt(LiveSurfaceReceiver.KEY_TILE_INDEX, 0)

            val payload = JSONObject(jsonPayload)
            val tile1 = payload.optJSONObject("tile1") ?: JSONObject()
            val tile2 = payload.optJSONObject("tile2") ?: JSONObject()
            val tile3 = payload.optJSONObject("tile3") ?: JSONObject()

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                val channel = NotificationChannel(CHANNEL_ID, "DVNT Live", NotificationManager.IMPORTANCE_LOW).apply {
                    description = "Live event and moments updates"
                    setShowBadge(false)
                }
                val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                nm.createNotificationChannel(channel)
            }

            val collapsedView = RemoteViews(context.packageName, R.layout.notification_live_surface)
            val expandedView = RemoteViews(context.packageName, R.layout.notification_live_surface_expanded)

            when (currentTile) {
                0 -> {
                    collapsedView.setTextViewText(R.id.tile_title, tile1.optString("title", "DVNT"))
                    val subtitle = buildString {
                        tile1.optString("venueName", "").let { if (it.isNotEmpty()) append(it) }
                        tile1.optString("city", "").let { if (it.isNotEmpty()) append(" \u00b7 $it") }
                    }
                    collapsedView.setTextViewText(R.id.tile_subtitle, subtitle)
                }
                1 -> {
                    collapsedView.setTextViewText(R.id.tile_title, "This Week's Top Moments")
                    collapsedView.setTextViewText(R.id.tile_subtitle, "Tap to view")
                }
                2 -> {
                    val tile3Items = tile3.optJSONArray("items")
                    val firstTitle = tile3Items?.optJSONObject(0)?.optString("title", "Events Soon") ?: "Events Soon"
                    collapsedView.setTextViewText(R.id.tile_title, firstTitle)
                    collapsedView.setTextViewText(R.id.tile_subtitle, "Upcoming events")
                }
            }

            val dotActive = android.graphics.Color.WHITE
            val dotInactive = android.graphics.Color.argb(77, 255, 255, 255)
            collapsedView.setInt(R.id.dot_0, "setBackgroundColor", if (currentTile == 0) dotActive else dotInactive)
            collapsedView.setInt(R.id.dot_1, "setBackgroundColor", if (currentTile == 1) dotActive else dotInactive)
            collapsedView.setInt(R.id.dot_2, "setBackgroundColor", if (currentTile == 2) dotActive else dotInactive)

            expandedView.setTextViewText(R.id.expanded_title, tile1.optString("title", "DVNT"))

            val tile2Items = tile2.optJSONArray("items")
            val gridIds = intArrayOf(R.id.grid_0, R.id.grid_1, R.id.grid_2, R.id.grid_3, R.id.grid_4, R.id.grid_5)
            for (i in 0 until 6) {
                val item = tile2Items?.optJSONObject(i)
                val deepLink = item?.optString("deepLink", "") ?: ""
                if (deepLink.isNotEmpty()) {
                    val intent = Intent(Intent.ACTION_VIEW, Uri.parse(deepLink))
                    val pi = PendingIntent.getActivity(context, 100 + i, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                    expandedView.setOnClickPendingIntent(gridIds[i], pi)
                }
            }

            expandedView.setInt(R.id.exp_dot_0, "setBackgroundColor", if (currentTile == 0) dotActive else dotInactive)
            expandedView.setInt(R.id.exp_dot_1, "setBackgroundColor", if (currentTile == 1) dotActive else dotInactive)
            expandedView.setInt(R.id.exp_dot_2, "setBackgroundColor", if (currentTile == 2) dotActive else dotInactive)

            val primaryDeepLink = when (currentTile) {
                0 -> tile1.optString("deepLink", "https://dvntlive.app/events")
                1 -> tile2.optString("recapDeepLink", "https://dvntlive.app/events")
                2 -> tile3.optString("seeAllDeepLink", "https://dvntlive.app/events?sort=soon")
                else -> "https://dvntlive.app/events"
            }
            val contentIntent = PendingIntent.getActivity(context, 200, Intent(Intent.ACTION_VIEW, Uri.parse(primaryDeepLink)), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

            val prevIntent = PendingIntent.getBroadcast(context, 300, Intent(LiveSurfaceReceiver.ACTION_PREV).setPackage(context.packageName), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
            val nextIntent = PendingIntent.getBroadcast(context, 301, Intent(LiveSurfaceReceiver.ACTION_NEXT).setPackage(context.packageName), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)

            val notification = NotificationCompat.Builder(context, CHANNEL_ID)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setCustomContentView(collapsedView)
                .setCustomBigContentView(expandedView)
                .setContentIntent(contentIntent)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .setCategory(NotificationCompat.CATEGORY_STATUS)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .addAction(0, "\u25c0", prevIntent)
                .addAction(0, "\u25b6", nextIntent)
                .build()

            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            nm.notify(NOTIFICATION_ID, notification)
        }
    }

    @ReactMethod
    fun updateNotification(jsonPayload: String) {
        showNotification(reactApplicationContext, jsonPayload)
    }

    @ReactMethod
    fun dismissNotification() {
        val nm = reactApplicationContext.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        nm.cancel(NOTIFICATION_ID)
    }
}
