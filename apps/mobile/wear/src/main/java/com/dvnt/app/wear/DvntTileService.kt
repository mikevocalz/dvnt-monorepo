package com.dvnt.app.wear

import androidx.wear.tiles.RequestBuilders
import androidx.wear.tiles.TileBuilders
import androidx.wear.tiles.TileService
import androidx.wear.protolayout.TimelineBuilders
import androidx.wear.protolayout.ActionBuilders
import androidx.wear.protolayout.ModifiersBuilders
import androidx.wear.protolayout.ResourceBuilders
import androidx.wear.protolayout.material3.ColorScheme
import androidx.wear.protolayout.material3.Typography
import androidx.wear.protolayout.material3.materialScope
import androidx.wear.protolayout.material3.primaryLayout
import androidx.wear.protolayout.material3.text
import androidx.wear.protolayout.material3.textEdgeButton
import androidx.wear.protolayout.types.argb
import androidx.wear.protolayout.types.layoutString
import androidx.concurrent.futures.CallbackToFutureAdapter

/** Material 3 title/main/bottom slots, entirely backed by the watch's account-scoped cache. */
class DvntTileService : TileService() {
    private fun <T> immediate(value: T): com.google.common.util.concurrent.ListenableFuture<T> = CallbackToFutureAdapter.getFuture { completer -> completer.set(value); "DVNT cached tile" }
    override fun onTileRequest(requestParams: RequestBuilders.TileRequest): com.google.common.util.concurrent.ListenableFuture<TileBuilders.Tile> {
        val snapshot = WearSurfaces.snapshot(this)
        val activity = ActionBuilders.AndroidActivity.Builder().setPackageName(packageName).setClassName(MainActivity::class.java.name)
            .addKeyToExtraMapping("destination", ActionBuilders.AndroidStringExtra.Builder().setValue(snapshot.destination).build())
            .addKeyToExtraMapping("accountGen", ActionBuilders.AndroidStringExtra.Builder().setValue(snapshot.accountGen).build())
            .addKeyToExtraMapping("eventId", ActionBuilders.AndroidStringExtra.Builder().setValue(snapshot.eventId ?: "").build()).build()
        val click = ModifiersBuilders.Clickable.Builder().setId("dvnt-open")
            .setOnClick(ActionBuilders.LaunchAction.Builder().setAndroidActivity(activity).build()).build()
        val layout = materialScope(this, requestParams.deviceConfiguration, allowDynamicTheme = false,
            defaultColorScheme = ColorScheme(primary = 0xff22d3ee.toInt().argb, onPrimary = 0xff050505.toInt().argb,
                background = 0xff050505.toInt().argb, onBackground = 0xfffafafa.toInt().argb)) {
            primaryLayout(
                titleSlot = { text("DVNT · Cached".layoutString, typography = Typography.LABEL_SMALL) },
                mainSlot = { text(snapshot.summary(System.currentTimeMillis()).layoutString, typography = Typography.BODY_MEDIUM, maxLines = 3) },
                bottomSlot = { textEdgeButton(onClick = click, labelContent = { text(snapshot.actionLabel.layoutString) }) }
            )
        }
        return immediate(TileBuilders.Tile.Builder().setResourcesVersion("dvnt-v2")
            .setFreshnessIntervalMillis(300_000).setTileTimeline(TimelineBuilders.Timeline.fromLayoutElement(layout)).build())
    }
    override fun onTileResourcesRequest(requestParams: RequestBuilders.ResourcesRequest) =
        immediate(ResourceBuilders.Resources.Builder().setVersion("dvnt-v2").build())
}
