package com.dvnt.app.wear

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import com.google.android.gms.tasks.Tasks
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.withContext

/**
 * Single source of truth for the Wear UI, and the Android analog of
 * `TicketStore.swift`.
 *
 * Two jobs, and the second is the one that matters:
 *
 *  1. Hold the last envelope the phone replicated onto this device.
 *  2. **Persist it**, so the app renders instantly and completely with the phone
 *     in another room, in airplane mode, or dead. WR-GL-05: a "Loading" screen is
 *     a failure state, not a state. The Data Layer replicates and persists the
 *     DataItem itself, but only the *system* keeps that copy — a cold start still
 *     has to wait on `getDataItems()`. This cache is what makes frame one useful.
 *
 * The repository is a process singleton because two entry points write into it —
 * [WearDataLayerService] (background, phone pushed while the app was closed) and
 * the foreground [DataClient.OnDataChangedListener] the activity registers. If
 * those held different instances the screen would show a stale set after a
 * background delivery.
 */
class TicketRepository private constructor(private val appContext: Context) {

    private val prefs = appContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private val _envelope = MutableStateFlow(loadCached())
    val envelope: StateFlow<WatchTicketEnvelope> = _envelope.asStateFlow()

    /** True once we have ever received a payload — distinguishes "no tickets" from
     *  "never paired", which are completely different empty states. */
    private val _everSynced = MutableStateFlow(prefs.contains(KEY_PAYLOAD))
    val everSynced: StateFlow<Boolean> = _everSynced.asStateFlow()

    // ------------------------------------------------------------------ ingestion

    /** Apply a raw envelope JSON string. No-op if it does not parse — a malformed
     *  push must leave the good cache in place rather than blanking the wrist. */
    fun ingest(json: String?) {
        val parsed = WatchTicketEnvelope.parse(json)
        if (parsed == null) {
            Log.w(TAG, "Dropped an unparseable /tickets payload; keeping the cache.")
            return
        }
        // Latest-wins, but never go backwards in time. Data Layer delivery is not
        // ordered, and a redelivered older item must not un-check a checked-in pass.
        val current = _envelope.value
        if (parsed.syncedAt in 1 until current.syncedAt) {
            Log.i(TAG, "Ignored an out-of-order /tickets payload (older syncedAt).")
            return
        }
        _envelope.value = parsed
        _everSynced.value = true
        prefs.edit().putString(KEY_PAYLOAD, json).apply()
    }

    /** Drain a Data Layer event buffer, taking only our path. */
    fun ingest(events: DataEventBuffer) {
        for (event in events) {
            if (event.type != DataEvent.TYPE_CHANGED) continue
            if (event.dataItem.uri.path != WearPaths.TICKETS) continue
            val map = DataMapItem.fromDataItem(event.dataItem).dataMap
            ingest(map.getString(WearPaths.KEY_PAYLOAD))
        }
    }

    /**
     * Cold-start reconciliation: the DataItem is already replicated on this device
     * even if no listener was alive when it arrived, so read it once on launch.
     * Blocking, so it is called off the main thread.
     */
    suspend fun hydrateFromDataLayer() = withContext(Dispatchers.IO) {
        runCatching {
            val items = Tasks.await(Wearable.getDataClient(appContext).dataItems)
            try {
                for (item in items) {
                    if (item.uri.path != WearPaths.TICKETS) continue
                    ingest(DataMapItem.fromDataItem(item).dataMap.getString(WearPaths.KEY_PAYLOAD))
                }
            } finally {
                items.release()
            }
        }.onFailure { Log.w(TAG, "Data Layer hydrate failed: ${it.message}") }
        Unit
    }

    // -------------------------------------------------------------- persisted cache

    private fun loadCached(): WatchTicketEnvelope =
        WatchTicketEnvelope.parse(prefs.getString(KEY_PAYLOAD, null)) ?: WatchTicketEnvelope.EMPTY

    companion object {
        private const val TAG = "DvntWear"
        private const val PREFS = "dvnt.wear.tickets"
        private const val KEY_PAYLOAD = "dvnt.tickets.envelope"

        @Volatile
        private var instance: TicketRepository? = null

        fun get(context: Context): TicketRepository =
            instance ?: synchronized(this) {
                instance ?: TicketRepository(context.applicationContext).also { instance = it }
            }
    }
}

/**
 * The contract shared with the phone. Changing a string here without changing
 * `WearTicketSender.kt` on the phone silently stops all sync, so they live in one
 * named place on each side.
 */
object WearPaths {
    /** DataClient — REPLICATED STATE. The analog of the Apple Watch's WCSession
     *  `applicationContext`: latest-wins, persisted, survives the peer being off. */
    const val TICKETS = "/tickets"

    /** MessageClient — a ONE-SHOT EVENT: "the watch is open, resend now". Never
     *  parks state; fails outright if the phone is unreachable, which is correct. */
    const val SYNC_REQUEST = "/tickets/sync-request"

    const val KEY_PAYLOAD = "payload"
    const val KEY_SYNCED_AT = "syncedAt"

    /** CapabilityClient names, declared in `res/values/wear.xml` on each side. */
    const val CAPABILITY_PHONE = "dvnt_phone_app"
    const val CAPABILITY_WEAR = "dvnt_wear_app"
}
