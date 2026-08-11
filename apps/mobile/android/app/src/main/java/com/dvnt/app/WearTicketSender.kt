package com.dvnt.app

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable

/**
 * The phone half of the Wear Data Layer. Writes the ticket envelope to
 * `/tickets`, where the watch's WearDataLayerService picks it up.
 *
 * Copied into the app module by plugins/with-wear-os.js — edit it there, not
 * in android/, which CNG deletes.
 *
 * Path and key strings are contracted with `WearPaths` in the wear module. If
 * you change one you must change both, or sync silently stops with no error on
 * either side.
 */
object WearTicketSender {
    private const val TAG = "DvntWear"
    private const val PATH_TICKETS = "/tickets"
    private const val KEY_PAYLOAD = "payload"
    private const val KEY_SYNCED_AT = "syncedAt"

    /**
     * Replicated state, not an event. Latest-wins, persisted by the system, and
     * it survives the watch being off — which is the whole reason tickets go
     * over DataClient and a ringing call does not.
     *
     * `syncedAt` is part of the map for two reasons: the watch renders honest
     * staleness from it, and it guarantees the bytes differ between two
     * otherwise-identical payloads. The Data Layer treats an identical write to
     * the same path as a no-op and never fires the listener, so a "resend"
     * without a changing field does nothing at all.
     */
    fun send(context: Context, payloadJson: String, syncedAtEpochMillis: Long) {
        val request = PutDataMapRequest.create(PATH_TICKETS).apply {
            dataMap.putString(KEY_PAYLOAD, payloadJson)
            dataMap.putLong(KEY_SYNCED_AT, syncedAtEpochMillis)
        }.asPutDataRequest()
            // Without setUrgent() the system batches delivery at its own
            // convenience, which can be tens of minutes. A member standing at
            // a door does not have tens of minutes.
            .setUrgent()

        Wearable.getDataClient(context.applicationContext)
            .putDataItem(request)
            .addOnSuccessListener { Log.d(TAG, "tickets synced to wear") }
            .addOnFailureListener { e -> Log.w(TAG, "wear sync failed", e) }
    }
}
