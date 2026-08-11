package com.dvnt.app.wear

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log
import androidx.wear.remote.interactions.RemoteActivityHelper
import com.google.android.gms.tasks.Tasks
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Everything the watch says TO the phone, and the one question it asks about it.
 *
 * The security shape, which is not negotiable and is why the manifest declares
 * `standalone=false`: **the watch holds no credentials.** No token, no bearer, no
 * OAuth flow on a 41mm screen. The phone owns the session; this device renders a
 * projection of it and sends intent back. Every one of those intents is input from
 * another process as far as the phone is concerned, and the phone validates it
 * (see `PhoneWearListenerService.kt`) rather than trusting it.
 */
object PhoneLink {

    private const val TAG = "DvntWear"

    /** Where a "keep going on the phone" tap lands. Handled by the app's deep-link
     *  routing; the phone, not the watch, decides what the member is allowed to see. */
    private const val TICKETS_DEEPLINK = "https://dvntapp.live/tickets"

    /** Whether the DVNT phone app is installed AND currently reachable.
     *
     *  This is asked, never assumed. `FILTER_REACHABLE` is the honest answer to
     *  "is anyone there" — the alternative is offering an "Open on phone" button
     *  that does nothing, which is worse than not offering it (WR-NO-04). */
    suspend fun phoneNodeId(context: Context): String? = withContext(Dispatchers.IO) {
        runCatching {
            val info = Tasks.await(
                Wearable.getCapabilityClient(context)
                    .getCapability(WearPaths.CAPABILITY_PHONE, CapabilityClient.FILTER_REACHABLE),
            )
            // Nodes are not stable identities — resolve fresh every time, never cache.
            (info.nodes.firstOrNull { it.isNearby } ?: info.nodes.firstOrNull())?.id
        }.onFailure { Log.w(TAG, "capability lookup failed: ${it.message}") }.getOrNull()
    }

    /**
     * "The watch is open, resend the current set."
     *
     * A MessageClient one-shot, NOT a DataItem: this is an event, it is worthless a
     * minute later, and it must fail loudly when the phone is unreachable instead
     * of being parked in replicated state and delivered tomorrow.
     *
     * @return true if the phone acknowledged receipt.
     */
    suspend fun requestSync(context: Context): Boolean = withContext(Dispatchers.IO) {
        val node = phoneNodeId(context) ?: return@withContext false
        runCatching {
            Tasks.await(
                Wearable.getMessageClient(context)
                    .sendMessage(node, WearPaths.SYNC_REQUEST, ByteArray(0)),
            )
            true
        }.onFailure { Log.w(TAG, "sync request failed: ${it.message}") }.getOrDefault(false)
    }

    /**
     * Open the tickets screen ON THE PHONE. The escape hatch for anything the wrist
     * should not do — transfers, receipts, a full event page.
     *
     * Only offered when [phoneNodeId] resolved; a dead button is a broken app.
     */
    fun openTicketsOnPhone(context: Context) {
        val intent = Intent(Intent.ACTION_VIEW)
            .addCategory(Intent.CATEGORY_BROWSABLE)
            .setData(Uri.parse(TICKETS_DEEPLINK))
        runCatching { RemoteActivityHelper(context).startRemoteActivity(intent) }
            .onFailure { Log.w(TAG, "startRemoteActivity failed: ${it.message}") }
    }
}
