package com.dvnt.app.wear

import android.app.PendingIntent
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.wear.tiles.TileService
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceUpdateRequester

/** No names, message bodies, QR tokens, or participant identity reach watch-face surfaces. */
data class WearSurfaceSnapshot(val accountGen: String, val unreadChats: Int, val nextAt: Long?, val eventId: String?,
    val destination: String, val actionLabel: String, val syncedAt: Long) {
    fun countdown(now: Long): String = nextAt?.let {
        val minutes = (it - now) / 60000
        when { minutes <= 0 -> "Now"; minutes < 60 -> "${minutes}m"; minutes < 1440 -> "${minutes / 60}h"; else -> "${minutes / 1440}d" }
    } ?: "DVNT"
    fun summary(now: Long): String = if (accountGen.isBlank()) "Open phone to sign in" else
        (if (nextAt != null) "Next event · ${countdown(now)}\n" else "") + "$unreadChats unread chats"
}

fun surfaceSnapshot(account: String, inbox: InboxState, tickets: WatchTicketEnvelope, events: EventsState, now: Long): WearSurfaceSnapshot {
    if (account.isBlank()) return WearSurfaceSnapshot("", 0, null, null, "Inbox", "Open DVNT", 0)
    val ticket = tickets.tickets.takeIf { tickets.accountGen == account }?.filter { t ->
        t.status.isPresentable && parseIso8601(t.eventDate) != null &&
            (parseIso8601(t.eventEndDate) ?: ((parseIso8601(t.eventDate) ?: 0) + 12 * 3600000)) > now
    }?.minByOrNull { parseIso8601(it.eventDate) ?: Long.MAX_VALUE }
    val event = events.events.takeIf { events.accountGen == account }?.filter { it.status == "active" && it.section(now) != "Past" && parseIso8601(it.startAt) != null }
        ?.minByOrNull { parseIso8601(it.startAt) ?: Long.MAX_VALUE }
    return WearSurfaceSnapshot(account, if (inbox.accountGen == account) inbox.conversations.count { it.unread } else 0,
        ticket?.eventDate?.let(::parseIso8601) ?: event?.startAt?.let(::parseIso8601), ticket?.eventId ?: event?.id,
        if (ticket != null) "Tickets" else if (event != null) "Events" else "Inbox",
        if (ticket != null) "Show pass" else if (event != null) "Open event" else "Open inbox",
        maxOf(if (inbox.accountGen == account) inbox.syncedAt else 0, if (tickets.accountGen == account) tickets.syncedAt else 0, if (events.accountGen == account) events.syncedAt else 0))
}
object WearSurfaces {
    fun snapshot(context: Context): WearSurfaceSnapshot = synchronized(WearAccountSession) {
        val account = WearAccountSession.generation(context)
        surfaceSnapshot(account, MessageRepository.get(context).inbox.value, TicketRepository.get(context).envelope.value,
            EventRepository.get(context).state.value, System.currentTimeMillis())
    }
    fun requestUpdate(context: Context) {
        // These APIs schedule updates; they do not promise immediate delivery to an off-screen face.
        runCatching { TileService.getUpdater(context).requestUpdate(DvntTileService::class.java) }
        runCatching { ComplicationDataSourceUpdateRequester.create(context, ComponentName(context, DvntComplicationService::class.java)).requestUpdateAll() }
    }
    fun openIntent(context: Context, destination: String, account: String, eventId: String? = null): Intent =
        Intent(context, MainActivity::class.java).setAction(Intent.ACTION_VIEW)
            .setData(Uri.parse("dvntwear://open/$destination/${Uri.encode(account)}/${Uri.encode(eventId ?: "")}"))
            .putExtra("destination", destination).putExtra("accountGen", account).putExtra("eventId", eventId)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP)
    fun pendingIntent(context: Context, destination: String, account: String, eventId: String? = null): PendingIntent =
        PendingIntent.getActivity(context, 0, openIntent(context, destination, account, eventId), PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
}
