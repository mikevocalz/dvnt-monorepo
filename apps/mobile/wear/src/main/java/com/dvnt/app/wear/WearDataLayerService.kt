package com.dvnt.app.wear

import android.util.Log
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.WearableListenerService

/**
 * Background delivery of `/tickets` on the WATCH side.
 *
 * The activity also registers a foreground `OnDataChangedListener`, but that only
 * covers the window where the app is on screen. This service is what makes a push
 * that lands while the app is closed — a ticket checked in at the door, a pass
 * revoked, an upgrade to VIP — already applied by the time the member raises their
 * wrist. Without it the first frame after a launch is always one sync stale.
 *
 * It does no work of its own beyond handing the payload to the shared
 * [TicketRepository], which persists it. No network, no wakelock, no notification:
 * a `WearableListenerService` that does real work is a battery bug.
 *
 * Deliberately NOT posting a notification here. Phone notifications bridge to the
 * watch automatically (WR-NO-01); posting our own on a replicated data change is
 * the two-buzzes-for-one-event bug that shows up in most shipped Wear apps.
 */
class WearDataLayerService : WearableListenerService() {

    override fun onDataChanged(dataEvents: DataEventBuffer) {
        Log.d(TAG, "onDataChanged from the phone")
        TicketRepository.get(applicationContext).ingest(dataEvents)
    }

    private companion object {
        const val TAG = "DvntWear"
    }
}
