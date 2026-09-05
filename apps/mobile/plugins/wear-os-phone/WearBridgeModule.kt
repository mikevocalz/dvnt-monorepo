package com.dvnt.app

import com.facebook.react.bridge.Arguments
import com.facebook.react.modules.core.DeviceEventManagerModule
import com.google.android.gms.wearable.PutDataMapRequest
import java.lang.ref.WeakReference
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

    init { active = WeakReference(this) }

    override fun getName() = NAME

    override fun invalidate() {
        if (active?.get() === this) active = null
        super.invalidate()
    }

    @ReactMethod fun addListener(eventName: String) { }
    @ReactMethod fun removeListeners(count: Double) { }

    @ReactMethod
    fun syncContext(payloadJson: String, syncedAt: Double, promise: Promise) {
        if (payloadJson.toByteArray(Charsets.UTF_8).size > 90_000) {
            promise.reject("E_WEAR_SIZE", "Watch context exceeds 90 KB")
            return
        }
        val request = PutDataMapRequest.create("/dvnt/context").apply {
            dataMap.putString("payload", payloadJson)
            dataMap.putLong("syncedAt", syncedAt.toLong())
        }.asPutDataRequest().setUrgent()
        Wearable.getDataClient(reactContext).putDataItem(request)
            .addOnSuccessListener { promise.resolve(true) }
            .addOnFailureListener { promise.reject("E_WEAR_SYNC", it.message, it) }
    }

    @ReactMethod
    fun sendResponse(nodeId: String, requestId: String, payloadJson: String, promise: Promise) {
        if (!requestId.matches(Regex("[0-9a-fA-F-]{36}")) || payloadJson.toByteArray(Charsets.UTF_8).size > 90_000) {
            promise.reject("E_WEAR_RESPONSE", "Invalid watch response")
            return
        }
        Wearable.getMessageClient(reactContext)
            .sendMessage(nodeId, "/dvnt/response/$requestId", payloadJson.toByteArray(Charsets.UTF_8))
            .addOnSuccessListener { promise.resolve(true) }
            .addOnFailureListener { promise.reject("E_WEAR_RESPONSE", it.message, it) }
    }

    @ReactMethod
    fun broadcastEvent(payloadJson: String, promise: Promise) {
        val bytes = payloadJson.toByteArray(Charsets.UTF_8)
        if (bytes.size > 90_000) { promise.reject("E_WEAR_SIZE", "Watch event exceeds 90 KB"); return }
        val path = "/dvnt/event/${java.util.UUID.randomUUID()}"
        Wearable.getCapabilityClient(reactContext).getCapability(CAPABILITY_WEAR, CapabilityClient.FILTER_REACHABLE)
            .addOnSuccessListener { info ->
                if (info.nodes.isEmpty()) promise.resolve(false)
                else com.google.android.gms.tasks.Tasks.whenAll(info.nodes.map { node ->
                    Wearable.getMessageClient(reactContext).sendMessage(node.id, path, bytes)
                }).addOnSuccessListener { promise.resolve(true) }
                    .addOnFailureListener { promise.reject("E_WEAR_EVENT", it.message, it) }
            }.addOnFailureListener { promise.reject("E_WEAR_EVENT", it.message, it) }
    }

    private fun emit(nodeId: String, requestId: String, payload: String): Boolean {
        if (!reactContext.hasActiveReactInstance()) return false
        val body = Arguments.createMap().apply {
            putString("nodeId", nodeId)
            putString("requestId", requestId)
            putString("payload", payload)
        }
        reactContext.getJSModule(DeviceEventManagerModule.RCTDeviceEventEmitter::class.java)
            .emit("DVNTWearMessage", body)
        return true
    }

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
                .addOnSuccessListener { promise.resolve(true) }
                .addOnFailureListener { promise.reject("E_WEAR_SYNC", it.message, it) }
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
        @Volatile private var active: WeakReference<WearBridgeModule>? = null
        fun deliver(nodeId: String, requestId: String, payload: String): Boolean =
            active?.get()?.emit(nodeId, requestId, payload) ?: false
        const val NAME = "DVNTWearBridge"
        private const val CAPABILITY_WEAR = "dvnt_wear_app"
    }
}
