package com.dvnt.app.wear

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.wear.ongoing.OngoingActivity
import androidx.wear.ongoing.Status
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeout

/** Native watch notification: no phone audio claim and no unsupported full-screen intent. */
object CallNotifications {
    private const val INCOMING = 4101
    private const val ONGOING = 4102
    fun allowed(context: Context): Boolean = (Build.VERSION.SDK_INT < 33 || context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED) && NotificationManagerCompat.from(context).areNotificationsEnabled()
    fun clear(context: Context) {
        NotificationManagerCompat.from(context).cancel(INCOMING)
        NotificationManagerCompat.from(context).cancel(ONGOING)
    }
    fun update(context: Context, state: CallsState) { synchronized(WearAccountSession) {
        if (state.accountGen.isNotBlank() && state.accountGen != WearAccountSession.generation(context)) return
        if (state.accountGen.isBlank() || !allowed(context)) { clear(context); return }
        val manager = context.getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(NotificationChannel("dvnt_calls", "Incoming DVNT calls", NotificationManager.IMPORTANCE_HIGH).apply {
            description = "Answer or decline a call on your phone from your watch"
            lockscreenVisibility = android.app.Notification.VISIBILITY_SECRET
        })
        manager.createNotificationChannel(NotificationChannel("dvnt_call_active", "Phone call controls", NotificationManager.IMPORTANCE_LOW).apply {
            description = "Return to companion controls while your phone call is active"
            lockscreenVisibility = android.app.Notification.VISIBILITY_SECRET
        })
        val now = System.currentTimeMillis() / 1000
        val incoming = state.incoming?.takeIf { it.isFresh(now) }
        if (incoming == null) manager.cancel(INCOMING) else {
            val open = WearSurfaces.pendingIntent(context, "Calls", state.accountGen)
            val builder = NotificationCompat.Builder(context, "dvnt_calls").setSmallIcon(R.drawable.ic_dvnt_call)
                .setContentTitle("Incoming DVNT call").setContentText(if (incoming.video) "Video call on your phone" else "Audio call on your phone")
                .setContentIntent(open).setCategory(NotificationCompat.CATEGORY_CALL).setVisibility(NotificationCompat.VISIBILITY_SECRET)
                .setLocalOnly(true).setOnlyAlertOnce(true).setOngoing(true).setTimeoutAfter((incoming.ringingSince + 30 - now).coerceAtLeast(1) * 1000)
                .addAction(R.drawable.ic_dvnt_call, "Answer on phone", action(context, state.accountGen, incoming, "accept"))
            if (incoming.video) builder.addAction(R.drawable.ic_dvnt_call, "Audio on phone", action(context, state.accountGen, incoming, "accept_audio_only"))
            builder.addAction(R.drawable.ic_dvnt_call, "Decline", action(context, state.accountGen, incoming, "decline"))
            try { manager.notify(INCOMING, builder.build()) } catch (_: SecurityException) { }
        }
        val active = state.active?.takeIf { it.isFresh(now) && it.roomId != null }
        if (active == null) manager.cancel(ONGOING) else {
            val open = WearSurfaces.pendingIntent(context, "Calls", state.accountGen)
            val label = "Phone call · ${active.phase}"
            val builder = NotificationCompat.Builder(context, "dvnt_call_active").setSmallIcon(R.drawable.ic_dvnt_call)
                .setContentTitle("DVNT").setContentText(label).setContentIntent(open).setOngoing(true).setOnlyAlertOnce(true)
                .setCategory(NotificationCompat.CATEGORY_CALL).setVisibility(NotificationCompat.VISIBILITY_SECRET).setLocalOnly(true)
                .setTimeoutAfter((active.expiresAt - now).coerceAtLeast(1) * 1000)
            val ongoing = OngoingActivity.Builder(context, ONGOING, builder).setStaticIcon(R.drawable.ic_dvnt_call)
                .setTouchIntent(open).setStatus(Status.forPart(Status.TextPart(label))).build()
            try { ongoing.apply(context); manager.notify(ONGOING, builder.build()) } catch (_: SecurityException) { }
        }
    } }
    private fun action(context: Context, generation: String, incoming: IncomingCompanionCall, action: String): PendingIntent {
        val callId = incoming.id
        val intent = Intent(context, CallActionReceiver::class.java).setAction("com.dvnt.app.CALL_ACTION")
            .setData(Uri.parse("dvntwear://call/${Uri.encode(generation)}/$callId/$action"))
            .putExtra("accountGen", generation).putExtra("callId", callId).putExtra("callAction", action)
            .putExtra("ringingSince", incoming.ringingSince).putExtra("isVideo", incoming.video).putExtra("isGroup", incoming.group)
            .putExtra("operationId", java.util.UUID.randomUUID().toString())
        return PendingIntent.getBroadcast(context, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }
}
class CallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val gen = intent.getStringExtra("accountGen") ?: return
        val id = intent.getStringExtra("callId") ?: return
        val action = intent.getStringExtra("callAction") ?: return
        if (action !in listOf("accept", "accept_audio_only", "decline")) return
        val operation = intent.getStringExtra("operationId")?.takeIf { it.matches(Regex("[0-9a-fA-F-]{36}")) } ?: return
        val incoming = IncomingCompanionCall(id, "Phone call", intent.getBooleanExtra("isVideo", false), intent.getBooleanExtra("isGroup", false), intent.getLongExtra("ringingSince", 0))
        if (!incoming.isFresh() || gen != WearAccountSession.generation(context)) return
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                val repo = CallRepository.get(context)
                withTimeout(8_000) { repo.command("callAction", action, expectedTarget = id, expectedGeneration = gen, notificationIncoming = incoming, notificationOperationId = operation) }
                CallNotifications.update(context, repo.state.value)
            } catch (_: Exception) {
                // Timed-out actions are never replayed by this receiver.
            } finally { pending.finish() }
        }
    }
}
