package com.dvnt.app

import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import com.google.android.gms.wearable.CapabilityClient
import com.google.android.gms.wearable.Wearable

/**
 * The JS seam for the Wear rail — the Android counterpart to the iOS
 * WCSession bridge that `packages/app/features/watch/watch-bridge.ts` already
 * talks to.
 *
 * Copied into the app module by plugins/with-wear-os.js, and REGISTERED by the
 * same plugin's MainApplication mod. Copying a ReactPackage into android/
 * without adding it to the package list produces a module that is simply
 * undefined at runtime with no error anywhere — see the note in
 * with-wear-os.js.
 *
 * Deliberately thin: it writes the envelope the JS layer already builds and
 * answers "is there a watch". No entitlement logic, no ticket shaping, and no
 * credentials — the watch is a projection of phone state (invariant I3 holds
 * on this rail too).
 */
class WearBridgeModule(private val reactContext: ReactApplicationContext) :
    ReactContextBaseJavaModule(reactContext) {

    override fun getName() = NAME

    /**
     * Push the ticket envelope to the watch.
     *
     * `syncedAt` arrives as a JS number (millis) because JS has no Long — the
     * bridge would silently truncate one. Double holds an epoch-millis value
     * exactly until well past the year 275760.
     */
    @ReactMethod
    fun syncTickets(payloadJson: String, syncedAt: Double, promise: Promise) {
        try {
            WearTicketSender.send(reactContext, payloadJson, syncedAt.toLong())
            promise.resolve(true)
        } catch (e: Throwable) {
            // Reject rather than swallow: the JS caller decides whether a
            // failed watch sync is worth surfacing, and a silently dropped
            // sync is exactly the bug that makes a wrist show stale tickets.
            promise.reject("E_WEAR_SYNC", e.message, e)
        }
    }

    /**
     * Whether a paired watch actually has the DVNT wear app installed.
     *
     * Answered by CapabilityClient rather than inferred from a delivery
     * timeout, so the JS layer can skip the work entirely instead of writing
     * DataItems into the void. FILTER_REACHABLE, because "installed on a watch
     * in a drawer" is not a reason to sync.
     */
    @ReactMethod
    fun isWearAppAvailable(promise: Promise) {
        Wearable.getCapabilityClient(reactContext)
            .getCapability(CAPABILITY_WEAR, CapabilityClient.FILTER_REACHABLE)
            .addOnSuccessListener { info -> promise.resolve(info.nodes.isNotEmpty()) }
            // Resolve false rather than reject: "we could not ask" and "no
            // watch" lead to the same caller behaviour, and a rejection here
            // would make every ticket refresh log an error on the ~100% of
            // installs that have no watch at all.
            .addOnFailureListener { promise.resolve(false) }
    }

    companion object {
        const val NAME = "DVNTWearBridge"
        private const val CAPABILITY_WEAR = "dvnt_wear_app"
    }
}
