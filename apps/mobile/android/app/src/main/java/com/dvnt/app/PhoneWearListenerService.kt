package com.dvnt.app

import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService

/**
 * Handles the watch's one-shot "resend now" on `/tickets/sync-request`.
 *
 * A MessageClient event, deliberately — a sync request is a thing that just
 * happened, not state. Parking it as a DataItem would leave a request that is
 * still "pending" tomorrow.
 *
 * Copied into the app module by plugins/with-wear-os.js.
 */
class PhoneWearListenerService : WearableListenerService() {

    override fun onMessageReceived(event: MessageEvent) {
        if (event.path != PATH_SYNC_REQUEST) return

        // Validate at the phone boundary. This message arrives from another
        // process; treat it as input, never as instruction. There is nothing
        // to parse here — the request carries no body on purpose, so there is
        // no field for a caller to lie in.
        Log.d(TAG, "wear requested a resync")

        // The JS layer owns the envelope, so the resend is a broadcast the RN
        // side observes rather than a query this service can answer alone.
        sendBroadcast(android.content.Intent(ACTION_WEAR_SYNC_REQUEST).setPackage(packageName))
    }

    companion object {
        private const val TAG = "DvntWear"
        private const val PATH_SYNC_REQUEST = "/tickets/sync-request"
        const val ACTION_WEAR_SYNC_REQUEST = "com.dvnt.app.WEAR_SYNC_REQUEST"
    }
}
