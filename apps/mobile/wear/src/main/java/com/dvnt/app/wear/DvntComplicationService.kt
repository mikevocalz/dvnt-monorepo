package com.dvnt.app.wear

import androidx.wear.watchface.complications.data.ComplicationData
import androidx.wear.watchface.complications.data.ComplicationType
import androidx.wear.watchface.complications.data.LongTextComplicationData
import androidx.wear.watchface.complications.data.PlainComplicationText
import androidx.wear.watchface.complications.data.ShortTextComplicationData
import androidx.wear.watchface.complications.data.NoDataComplicationData
import androidx.wear.watchface.complications.data.TimeRange
import androidx.wear.watchface.complications.datasource.ComplicationDataSourceService
import androidx.wear.watchface.complications.datasource.ComplicationRequest
import java.time.Instant

class DvntComplicationService : ComplicationDataSourceService() {
    override fun onComplicationRequest(request: ComplicationRequest, listener: ComplicationRequestListener) {
        val snapshot = WearSurfaces.snapshot(this)
        listener.onComplicationData(data(request.complicationType, snapshot, false))
    }
    override fun getPreviewData(type: ComplicationType): ComplicationData? = data(type, WearSurfaceSnapshot("", 0, null, null, "Inbox", "Open DVNT", 0), true)
    private fun text(value: String) = PlainComplicationText.Builder(value).build()
    private fun data(type: ComplicationType, snapshot: WearSurfaceSnapshot, preview: Boolean): ComplicationData {
        val now = System.currentTimeMillis()
        val description = if (preview) "DVNT. Next event and unread chats." else "Cached DVNT snapshot. ${snapshot.summary(now)}"
        val tap = WearSurfaces.pendingIntent(this, snapshot.destination, snapshot.accountGen, snapshot.eventId)
        val valid = if (preview) TimeRange.ALWAYS else TimeRange.before(Instant.ofEpochMilli(now + 900_000))
        return when (type) {
            ComplicationType.SHORT_TEXT -> ShortTextComplicationData.Builder(text(if (preview || snapshot.accountGen.isBlank()) "DVNT" else if (snapshot.nextAt != null) snapshot.countdown(now) else snapshot.unreadChats.toString()), text(description))
                .setTitle(text(if (snapshot.nextAt != null) "Event" else "Unread"))
                .setTapAction(tap).setValidTimeRange(valid).build()
            ComplicationType.LONG_TEXT -> LongTextComplicationData.Builder(text(if (preview) "Open DVNT" else snapshot.summary(now).replace('\n', ' ')), text(description))
                .setTitle(text("DVNT · Cached")).setTapAction(tap).setValidTimeRange(valid).build()
            else -> NoDataComplicationData()
        }
    }
}
