/**
 * CallKeep Wrapper Module
 *
 * Centralized interface for native call UI (CallKit on iOS, ConnectionService on Android).
 * ALL CallKeep interactions MUST go through this module.
 * Direct imports of 'react-native-callkeep' outside this file are FORBIDDEN.
 *
 * Integrates with:
 * - Fishjam for audio/video transport
 * - Supabase for call session state
 * - MMKV for callSessionId <-> callUUID mapping persistence
 */

import RNCallKeep, { CONSTANTS } from "react-native-callkeep";
import { Platform, PermissionsAndroid } from "react-native";
import { createMMKV } from "react-native-mmkv";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StartOutgoingCallParams {
  callUUID: string;
  handle: string;
  displayName: string;
  hasVideo: boolean;
}

export interface ShowIncomingCallParams {
  callUUID: string;
  handle: string;
  displayName: string;
  hasVideo: boolean;
}

export type CallKeepAnswerHandler = (data: { callUUID: string }) => void;
export type CallKeepEndHandler = (data: { callUUID: string }) => void;
export type CallKeepDidDisplayHandler = (data: {
  callUUID: string;
  error?: string;
}) => void;
export type CallKeepToggleMuteHandler = (data: {
  callUUID: string;
  muted: boolean;
}) => void;
export type CallKeepAudioSessionHandler = () => void;

// ---------------------------------------------------------------------------
// MMKV storage for callSessionId <-> callUUID mapping
// ---------------------------------------------------------------------------

const callkeepStorage = createMMKV({ id: "callkeep-mapping" });

const MAPPING_PREFIX = "ck:uuid:";
const REVERSE_PREFIX = "ck:session:";

/**
 * Persist a bidirectional mapping: callSessionId <-> callUUID
 */
export function persistCallMapping(
  callSessionId: string,
  callUUID: string,
): void {
  callkeepStorage.set(`${MAPPING_PREFIX}${callUUID}`, callSessionId);
  callkeepStorage.set(`${REVERSE_PREFIX}${callSessionId}`, callUUID);
  console.log(
    `[CallKeep] Persisted mapping: session=${callSessionId} <-> uuid=${callUUID}`,
  );
}

/**
 * Look up callSessionId from a device-local callUUID.
 */
export function getSessionIdFromUUID(callUUID: string): string | undefined {
  return callkeepStorage.getString(`${MAPPING_PREFIX}${callUUID}`);
}

/**
 * Look up callUUID from a Supabase callSessionId.
 */
export function getUUIDFromSessionId(
  callSessionId: string,
): string | undefined {
  return callkeepStorage.getString(`${REVERSE_PREFIX}${callSessionId}`);
}

/**
 * Remove mapping for a given callUUID.
 */
export function clearCallMapping(callUUID: string): void {
  const sessionId = callkeepStorage.getString(`${MAPPING_PREFIX}${callUUID}`);
  callkeepStorage.remove(`${MAPPING_PREFIX}${callUUID}`);
  if (sessionId) {
    callkeepStorage.remove(`${REVERSE_PREFIX}${sessionId}`);
  }
  // Also clear the displayed-call dedupe so a new call to the same room works
  _displayedCallUUIDs.delete(callUUID);
}

// ---------------------------------------------------------------------------
// Singleton guard — listeners must be registered exactly ONCE
// ---------------------------------------------------------------------------

let _listenersRegistered = false;
let _setupComplete = false;

// ── Shared dedupe for incoming call display ──────────────────────────
// Multiple sources (Realtime subscription, push notification, cold start)
// may try to show the incoming call UI for the same room. This set ensures
// displayIncomingCall() is only called ONCE per callUUID.
const _displayedCallUUIDs = new Set<string>();

/** Check if an incoming call UI was already displayed for this UUID */
export function wasCallDisplayed(callUUID: string): boolean {
  return _displayedCallUUIDs.has(callUUID);
}

/** Clear displayed state (call cleanup) */
export function clearDisplayedCall(callUUID: string): void {
  _displayedCallUUIDs.delete(callUUID);
}

// Store references so we can remove them if needed
const _eventListeners: Array<{ remove: () => void }> = [];

// ---------------------------------------------------------------------------
// Android runtime permissions
// ---------------------------------------------------------------------------

/**
 * Request all runtime permissions required by CallKeep on Android.
 * Must be called BEFORE RNCallKeep.setup() to prevent SecurityException
 * in VoiceConnectionService.createConnection() → telecomManager.getPhoneAccount().
 *
 * On Android 30+ (API 30 = Android 11): READ_PHONE_NUMBERS replaces READ_PHONE_STATE
 * On Android < 30: READ_PHONE_STATE is sufficient
 *
 * Returns true if all critical permissions were granted.
 */
async function ensureAndroidCallPermissions(): Promise<boolean> {
  if (Platform.OS !== "android") return true;

  try {
    const sdkInt = Platform.Version;
    const permissionsToRequest: string[] = [];

    // READ_PHONE_NUMBERS (Android 30+) or READ_PHONE_STATE (older)
    if (sdkInt >= 30) {
      const phoneNumbersStatus = await PermissionsAndroid.check(
        "android.permission.READ_PHONE_NUMBERS" as any,
      );
      if (!phoneNumbersStatus) {
        permissionsToRequest.push("android.permission.READ_PHONE_NUMBERS");
      }
    } else {
      const phoneStateStatus = await PermissionsAndroid.check(
        PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
      );
      if (!phoneStateStatus) {
        permissionsToRequest.push(
          PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE,
        );
      }
    }

    // CALL_PHONE
    const callPhoneStatus = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.CALL_PHONE,
    );
    if (!callPhoneStatus) {
      permissionsToRequest.push(PermissionsAndroid.PERMISSIONS.CALL_PHONE);
    }

    // RECORD_AUDIO (CallKeep checks this in selfManaged mode)
    const recordAudioStatus = await PermissionsAndroid.check(
      PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
    );
    if (!recordAudioStatus) {
      permissionsToRequest.push(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
    }

    if (permissionsToRequest.length === 0) {
      console.log("[CallKeep] All Android call permissions already granted");
      return true;
    }

    console.log(
      "[CallKeep] Requesting Android permissions:",
      permissionsToRequest,
    );
    const results = await PermissionsAndroid.requestMultiple(
      permissionsToRequest as any[],
    );

    const allGranted = Object.values(results).every(
      (r) => r === PermissionsAndroid.RESULTS.GRANTED,
    );

    if (!allGranted) {
      console.warn("[CallKeep] Some Android call permissions denied:", results);
    } else {
      console.log("[CallKeep] All Android call permissions granted");
    }

    // Return true even if some denied — CallKeep may still partially work
    // in selfManaged mode. The critical one is READ_PHONE_NUMBERS.
    const criticalPerm =
      sdkInt >= 30
        ? "android.permission.READ_PHONE_NUMBERS"
        : PermissionsAndroid.PERMISSIONS.READ_PHONE_STATE;
    const criticalGranted =
      results[criticalPerm] === PermissionsAndroid.RESULTS.GRANTED ||
      !permissionsToRequest.includes(criticalPerm);

    if (!criticalGranted) {
      console.error(
        `[CallKeep] CRITICAL: ${criticalPerm} denied — CallKeep will likely crash on outgoing calls`,
      );
    }

    return criticalGranted;
  } catch (err) {
    console.error("[CallKeep] Permission request failed:", err);
    return false;
  }
}

// Track whether Android permissions were granted
let _androidPermsGranted = false;

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Initialize CallKeep. Must be called once at app startup (root layout).
 * Safe to call multiple times — subsequent calls are no-ops.
 */
export async function setupCallKeep(): Promise<void> {
  if (_setupComplete) {
    console.log("[CallKeep] Already set up, skipping");
    return;
  }

  // Request Android runtime permissions BEFORE setup
  _androidPermsGranted = await ensureAndroidCallPermissions();

  try {
    await RNCallKeep.setup({
      ios: {
        appName: "DVNT",
        supportsVideo: true,
        maximumCallGroups: "1",
        maximumCallsPerCallGroup: "1",
        includesCallsInRecents: true,
        ringtoneSound: "dvnt-ring.wav",
        audioSession: {
          categoryOptions: 0x1 | 0x4 | 0x8 | 0x20, // mixWithOthers | allowBluetooth | defaultToSpeaker | allowBluetoothA2DP
          mode: "AVAudioSessionModeVideoChat",
        },
      },
      android: {
        alertTitle: "Permissions Required",
        alertDescription:
          "DVNT needs access to your phone account to manage calls",
        cancelButton: "Cancel",
        okButton: "OK",
        additionalPermissions: [],
        selfManaged: true,
        foregroundService: {
          channelId: "com.dvnt.app.calls",
          channelName: "DVNT Calls",
          notificationTitle: "DVNT Call in Progress",
          notificationIcon: "ic_notification",
        },
      },
    });

    if (Platform.OS === "android") {
      RNCallKeep.setAvailable(true);
      RNCallKeep.canMakeMultipleCalls(false);
      RNCallKeep.registerAndroidEvents();
    }

    _setupComplete = true;
    console.log("[CallKeep] Setup complete");
  } catch (err) {
    console.error("[CallKeep] Setup failed:", err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Call actions
// ---------------------------------------------------------------------------

/**
 * Report an outgoing call to the OS call UI.
 */
export function startOutgoingCall({
  callUUID,
  handle,
  displayName,
  hasVideo,
}: StartOutgoingCallParams): void {
  console.log(
    `[CallKeep] startOutgoingCall uuid=${callUUID} handle=${handle} video=${hasVideo}`,
  );
  try {
    RNCallKeep.startCall(callUUID, handle, displayName, "generic", hasVideo);

    if (Platform.OS === "ios") {
      // Report connecting → connected lifecycle on iOS
      RNCallKeep.reportConnectingOutgoingCallWithUUID(callUUID);
    }
  } catch (err) {
    // Defense-in-depth: catch native exceptions (e.g. SecurityException on Android)
    // so the call can still proceed without native call UI
    console.error("[CallKeep] startOutgoingCall native error:", err);
  }
}

/**
 * Mark an outgoing call as connected (call answered / media flowing).
 */
export function reportOutgoingCallConnected(callUUID: string): void {
  try {
    if (Platform.OS === "ios") {
      RNCallKeep.reportConnectedOutgoingCallWithUUID(callUUID);
    } else {
      RNCallKeep.setCurrentCallActive(callUUID);
    }
    console.log(`[CallKeep] Outgoing call connected uuid=${callUUID}`);
  } catch (err) {
    console.error("[CallKeep] reportOutgoingCallConnected native error:", err);
  }
}

/**
 * Display the native incoming call UI.
 */
export function showIncomingCall({
  callUUID,
  handle,
  displayName,
  hasVideo,
}: ShowIncomingCallParams): void {
  // CRITICAL DEDUPE: Prevent double incoming call UI.
  // Both Realtime subscription and push notification may fire for the same call.
  // Two displayIncomingCall() calls create two native call entries — the second
  // blocks Accept on the first, causing "call not accepted" bug.
  if (_displayedCallUUIDs.has(callUUID)) {
    console.log(
      `[CallKeep] showIncomingCall SKIPPED (already displayed) uuid=${callUUID}`,
    );
    return;
  }
  _displayedCallUUIDs.add(callUUID);
  // Auto-clear after 60s to prevent memory leak
  setTimeout(() => _displayedCallUUIDs.delete(callUUID), 60000);

  console.log(
    `[CallKeep] showIncomingCall uuid=${callUUID} handle=${handle} video=${hasVideo}`,
  );
  try {
    RNCallKeep.displayIncomingCall(
      callUUID,
      handle,
      displayName,
      "generic",
      hasVideo,
    );
  } catch (err) {
    console.error("[CallKeep] showIncomingCall native error:", err);
  }
}

/**
 * End a call in the OS call UI. Idempotent — safe to call multiple times.
 */
export function endCall(callUUID: string): void {
  console.log(`[CallKeep] endCall uuid=${callUUID}`);
  try {
    RNCallKeep.endCall(callUUID);
  } catch (err) {
    // Swallow — call may already be ended
    console.warn("[CallKeep] endCall error (likely already ended):", err);
  }
}

/**
 * End all active calls in the OS call UI.
 */
export function endAllCalls(): void {
  console.log("[CallKeep] endAllCalls");
  try {
    RNCallKeep.endAllCalls();
  } catch (err) {
    console.error("[CallKeep] endAllCalls native error:", err);
  }
}

/**
 * Report a call end with a specific reason to the OS.
 */
export function reportEndCall(
  callUUID: string,
  reason: keyof typeof CONSTANTS.END_CALL_REASONS,
): void {
  console.log(`[CallKeep] reportEndCall uuid=${callUUID} reason=${reason}`);
  try {
    RNCallKeep.reportEndCallWithUUID(
      callUUID,
      CONSTANTS.END_CALL_REASONS[reason],
    );
  } catch (err) {
    console.error("[CallKeep] reportEndCall native error:", err);
  }
}

/**
 * Mark a call as active in the OS (Android only, used after answering).
 */
export function setCallActive(callUUID: string): void {
  try {
    if (Platform.OS === "android") {
      RNCallKeep.setCurrentCallActive(callUUID);
    }
    console.log(`[CallKeep] setCallActive uuid=${callUUID}`);
  } catch (err) {
    console.error("[CallKeep] setCallActive native error:", err);
  }
}

/**
 * Set mute state for a call in the OS call UI.
 */
export function setMuted(callUUID: string, muted: boolean): void {
  try {
    RNCallKeep.setMutedCall(callUUID, muted);
    console.log(`[CallKeep] setMuted uuid=${callUUID} muted=${muted}`);
  } catch (err) {
    console.error("[CallKeep] setMuted native error:", err);
  }
}

/**
 * Update the caller display name/handle for an active call.
 */
export function updateDisplay(
  callUUID: string,
  displayName: string,
  handle: string,
): void {
  try {
    RNCallKeep.updateDisplay(callUUID, displayName, handle);
  } catch (err) {
    console.error("[CallKeep] updateDisplay native error:", err);
  }
}

/**
 * Bring the app to the foreground (Android only).
 */
export function backToForeground(): void {
  try {
    RNCallKeep.backToForeground();
  } catch (err) {
    console.error("[CallKeep] backToForeground native error:", err);
  }
}

// ---------------------------------------------------------------------------
// Event listeners — register ONCE
// ---------------------------------------------------------------------------

/**
 * Register all CallKeep event listeners. MUST be called exactly once
 * from the root layout. Subsequent calls are no-ops.
 *
 * Returns a cleanup function that removes all listeners.
 */
export function registerCallKeepListeners(handlers: {
  onAnswer: CallKeepAnswerHandler;
  onEnd: CallKeepEndHandler;
  onDidDisplayIncoming?: CallKeepDidDisplayHandler;
  onToggleMute?: CallKeepToggleMuteHandler;
  onAudioSessionActivated?: CallKeepAudioSessionHandler;
}): () => void {
  if (_listenersRegistered) {
    console.warn(
      "[CallKeep] Listeners already registered — skipping duplicate registration",
    );
    return () => {};
  }

  _listenersRegistered = true;
  console.log("[CallKeep] Registering event listeners");

  const answerListener = RNCallKeep.addEventListener(
    "answerCall",
    (data: { callUUID: string }) => {
      console.log(`[CallKeep] Event: answerCall uuid=${data.callUUID}`);
      handlers.onAnswer({ callUUID: data.callUUID });
    },
  );
  _eventListeners.push(answerListener);

  const endListener = RNCallKeep.addEventListener(
    "endCall",
    (data: { callUUID: string }) => {
      console.log(`[CallKeep] Event: endCall uuid=${data.callUUID}`);
      handlers.onEnd({ callUUID: data.callUUID });
    },
  );
  _eventListeners.push(endListener);

  const displayListener = RNCallKeep.addEventListener(
    "didDisplayIncomingCall",
    (data: any) => {
      console.log(
        `[CallKeep] Event: didDisplayIncomingCall uuid=${data.callUUID} error=${data.error}`,
      );
      handlers.onDidDisplayIncoming?.({
        callUUID: data.callUUID,
        error: data.error,
      });
    },
  );
  _eventListeners.push(displayListener);

  if (handlers.onToggleMute) {
    const muteListener = RNCallKeep.addEventListener(
      "didPerformSetMutedCallAction",
      (data: { muted: boolean; callUUID: string }) => {
        console.log(
          `[CallKeep] Event: didPerformSetMutedCallAction uuid=${data.callUUID} muted=${data.muted}`,
        );
        handlers.onToggleMute!({
          callUUID: data.callUUID,
          muted: data.muted,
        });
      },
    );
    _eventListeners.push(muteListener);
  }

  if (handlers.onAudioSessionActivated) {
    const audioListener = RNCallKeep.addEventListener(
      "didActivateAudioSession",
      () => {
        console.log("[CallKeep] Event: didActivateAudioSession");
        handlers.onAudioSessionActivated!();
      },
    );
    _eventListeners.push(audioListener);
  }

  // Handle the case where the app was launched from a killed state by an incoming call
  RNCallKeep.getInitialEvents().then((events) => {
    if (events && events.length > 0) {
      console.log("[CallKeep] Processing initial events:", events.length);
      for (const event of events) {
        if (event.name === "RNCallKeepPerformAnswerCallAction") {
          handlers.onAnswer({ callUUID: (event.data as any).callUUID });
        } else if (event.name === "RNCallKeepPerformEndCallAction") {
          handlers.onEnd({ callUUID: (event.data as any).callUUID });
        }
      }
      RNCallKeep.clearInitialEvents();
    }
  });

  return () => {
    console.log("[CallKeep] Removing event listeners");
    for (const listener of _eventListeners) {
      listener.remove();
    }
    _eventListeners.length = 0;
    _listenersRegistered = false;
  };
}

// ---------------------------------------------------------------------------
// Re-export constants
// ---------------------------------------------------------------------------

export { CONSTANTS as CALLKEEP_CONSTANTS };
