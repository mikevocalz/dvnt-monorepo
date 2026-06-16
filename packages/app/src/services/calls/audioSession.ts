/**
 * audioSession.ts — Single source of truth for in-call audio session + routing.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  This is the ONLY module that may:                                 ║
 * ║    - Start/stop in-call audio mode                                 ║
 * ║    - Set speaker on/off                                            ║
 * ║    - Set mic mute on/off                                           ║
 * ║    - Signal RTCAudioSession activation/deactivation                ║
 * ║                                                                    ║
 * ║  Uses react-native-incall-manager for cross-platform audio         ║
 * ║  session management. RTCAudioSession from Fishjam is used ONLY     ║
 * ║  for CallKit activation/deactivation signals on iOS.               ║
 * ║                                                                    ║
 * ║  INVARIANT: No other file may call InCallManager directly.         ║
 * ║  INVARIANT: No other file may call RTCAudioSession directly.       ║
 * ║                                                                    ║
 * ║  iOS AUDIO SESSION LIFECYCLE (CRITICAL FIX):                       ║
 * ║    1. start() → InCallManager.start() configures AVAudioSession    ║
 * ║       category/mode but does NOT call audioSessionDidActivate().   ║
 * ║    2. CallKit fires didActivateAudioSession → coordinator calls    ║
 * ║       audioSession.activateFromCallKit() which calls               ║
 * ║       RTCAudioSession.audioSessionDidActivate() + applies speaker. ║
 * ║    3. activateFromCallKit() ALSO calls pendingMicStartCallback     ║
 * ║       which actually starts the microphone AFTER session is live.  ║
 * ║    4. Only AFTER step 3 is audio actually flowing on iOS.          ║
 * ║                                                                    ║
 * ║  On Android, start() handles everything (no CallKit).              ║
 * ║                                                                    ║
 * ║  REF: https://docs.fishjam.io/how-to/react-native/connecting      ║
 * ║  REF: https://docs.fishjam.io/how-to/react-native/start-streaming ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { NativeEventEmitter, NativeModules, Platform } from "react-native";
import InCallManager from "react-native-incall-manager";
import { RTCAudioSession } from "@fishjam-cloud/react-native-webrtc";
import { CT } from "@dvnt/app/src/services/calls/callTrace";

// ── Internal state ──────────────────────────────────────────────────

let _isActive = false;
let _isCallKitActivated = false;
let _isSpeakerOn = false;
let _isMicMuted = false;
let _pendingSpeakerOn: boolean | null = null;

// CRITICAL FIX: Callback to start mic AFTER CallKit activation on iOS
let _pendingMicStartCallback: (() => Promise<void>) | null = null;

// ── Route-change handling (full fix for headphone / BT mid-session) ────────
//
// The user's speaker PREFERENCE is tracked separately from the actual
// current route. Plugged wired headphones and connected Bluetooth
// ALWAYS win over the user's speaker preference — matches iOS /
// FaceTime / Zoom behavior: a plugged device takes priority.
//
//   _userWantsSpeaker — sticky preference set by the UI toggle. Only
//     honored when no external audio device is connected.
//   _hasExternalRoute — live state derived from the platform's
//     route-change events (see subscriptions below). When true, we
//     never force-speaker even if _userWantsSpeaker is true.
//
// On EVERY route-change event from the platform we re-evaluate and
// call `_reapplyRoute()`. This is the piece the previous fix was
// missing — it only checked at session start, not during.
let _userWantsSpeaker = false;
let _hasExternalRoute = false;
let _wiredSubscription: { remove: () => void } | null = null;
let _deviceSubscription: { remove: () => void } | null = null;
let _routeSubscribed = false;

function parseAndroidDeviceList(raw: unknown): string[] {
  // Android's onAudioDeviceChanged payload stringifies the list:
  // `"[\"SPEAKER_PHONE\",\"BLUETOOTH\",\"WIRED_HEADSET\",\"EARPIECE\"]"`
  if (typeof raw !== "string") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function _reapplyRoute() {
  // Wired / BT present → never force speaker; let the platform route
  // naturally (iOS: AVAudioSession picks the plugged device over
  // built-in speaker; Android: our last chooseAudioRoute() below).
  try {
    if (_hasExternalRoute) {
      InCallManager.setForceSpeakerphoneOn(false);
      _isSpeakerOn = false;
      CT.trace("AUDIO", "audioSession_route_external", {});
      return;
    }
    InCallManager.setForceSpeakerphoneOn(_userWantsSpeaker);
    _isSpeakerOn = _userWantsSpeaker;
    CT.trace("AUDIO", "audioSession_route_internal", {
      speaker: _userWantsSpeaker,
    });
  } catch (e: any) {
    CT.error("AUDIO", "audioSession_reapply_route_failed", {
      error: e?.message,
    });
  }
}

function _subscribeToRouteChanges() {
  if (_routeSubscribed) return;

  // `NativeEventEmitter` bound to the InCallManager native module. Both
  // iOS (RNInCallManager.m:810+) and Android (InCallManagerModule.java:289
  // + 1847) emit named events on the module's event emitter.
  const nativeModule = (NativeModules as any)?.InCallManager;
  if (!nativeModule) {
    CT.trace("AUDIO", "audioSession_route_listener_missing_module", {});
    return;
  }
  const emitter = new NativeEventEmitter(nativeModule);

  _wiredSubscription = emitter.addListener("WiredHeadset", (event: any) => {
    // Event shape (from the lib): { isPlugged, hasMic, deviceName }
    const pluggedIn = !!event?.isPlugged;
    if (pluggedIn) {
      _hasExternalRoute = true;
    } else if (Platform.OS === "ios") {
      // On iOS, if the wired cable is gone we can't know from this
      // event alone whether BT is still connected. Use the sync probe
      // before flipping off.
      InCallManager.getIsWiredHeadsetPluggedIn()
        .then((res: { isWiredHeadsetPluggedIn: boolean }) => {
          if (!res.isWiredHeadsetPluggedIn) {
            _hasExternalRoute = false;
            _reapplyRoute();
          }
        })
        .catch(() => {
          _hasExternalRoute = false;
          _reapplyRoute();
        });
      _reapplyRoute();
      return;
    } else {
      _hasExternalRoute = false;
    }
    _reapplyRoute();
  });

  // Android-only — fires on BT / SCO / any audio device list change.
  // Payload has `availableAudioDeviceList` (JSON string) and
  // `selectedAudioDevice`. We treat WIRED_HEADSET or BLUETOOTH as
  // external routes that take priority over the speaker toggle.
  if (Platform.OS === "android") {
    _deviceSubscription = emitter.addListener(
      "onAudioDeviceChanged",
      (event: any) => {
        const list = parseAndroidDeviceList(event?.availableAudioDeviceList);
        const hasBt = list.includes("BLUETOOTH");
        const hasWired = list.includes("WIRED_HEADSET");
        _hasExternalRoute = hasBt || hasWired;

        // When an external device becomes available, ask InCallManager
        // to route through it explicitly. Preferred: BT > wired > the
        // speaker preference. When the only remaining routes are
        // speaker + earpiece, honor the user's toggle.
        try {
          if (hasBt) {
            InCallManager.chooseAudioRoute("BLUETOOTH");
          } else if (hasWired) {
            InCallManager.chooseAudioRoute("WIRED_HEADSET");
          } else if (_userWantsSpeaker) {
            InCallManager.chooseAudioRoute("SPEAKER_PHONE");
          } else {
            InCallManager.chooseAudioRoute("EARPIECE");
          }
        } catch (e: any) {
          CT.error("AUDIO", "audioSession_chooseAudioRoute_failed", {
            error: e?.message,
          });
        }
        _reapplyRoute();
      },
    );
  }

  _routeSubscribed = true;
  CT.trace("AUDIO", "audioSession_route_subscribed", {});
}

function _unsubscribeFromRouteChanges() {
  try {
    _wiredSubscription?.remove();
  } catch {}
  try {
    _deviceSubscription?.remove();
  } catch {}
  _wiredSubscription = null;
  _deviceSubscription = null;
  _routeSubscribed = false;
}

// ── Public API ──────────────────────────────────────────────────────

export const audioSession = {
  /**
   * Start in-call audio session. Call when entering CONNECTING or IN_CALL.
   *
   * iOS: Configures AVAudioSession category/mode via InCallManager.
   *      Does NOT call RTCAudioSession.audioSessionDidActivate() — that
   *      MUST come from the CallKeep didActivateAudioSession handler via
   *      activateFromCallKit(). Speaker routing is deferred until activation.
   *      MIC START is also deferred via setPendingMicStart().
   *
   * Android: Sets audio mode to IN_COMMUNICATION, acquires audio focus,
   *          and applies speaker routing immediately (no CallKit on Android).
   *
   * @param speakerOn - Whether to default to speaker (true for video calls, false for audio)
   */
  start(
    speakerOn: boolean = true,
    mediaType: "audio" | "video" = "audio",
  ): void {
    CT.trace("AUDIO", "audioSession_starting", {
      speakerOn,
      mediaType,
      wasActive: _isActive,
      platform: Platform.OS,
    });

    try {
      // Reset pending state from any previous call — but do NOT reset
      // _isCallKitActivated here. CallKit fires didActivateAudioSession
      // ONCE per call. If it already fired (e.g., caller: after startOutgoingCall,
      // callee: after answering), resetting it would prevent setPendingMicStart()
      // from detecting that activation already happened → mic never starts.
      // _isCallKitActivated is only reset in stop() at end of call.
      _pendingMicStartCallback = null;
      _pendingSpeakerOn = null;

      // ALWAYS call InCallManager.start — even if _isActive is true.
      // A previous call may not have cleaned up properly.
      //
      // CRITICAL: mediaType controls AVAudioSession mode on iOS:
      //   "audio" → voiceChat (earpiece default)
      //   "video" → videoChat (speaker default, echo cancellation tuned for speaker)
      // Android: AudioManager mode = MODE_IN_COMMUNICATION, requests audio focus
      // REF: https://docs.fishjam.io/how-to/react-native/connecting
      InCallManager.start({ media: mediaType, auto: true });

      _isActive = true;
      _userWantsSpeaker = speakerOn;

      // Subscribe route-change listeners so plug / unplug / BT
      // connect during the call re-applies the preference live.
      _subscribeToRouteChanges();
      InCallManager.getIsWiredHeadsetPluggedIn()
        .then((res: { isWiredHeadsetPluggedIn: boolean }) => {
          _hasExternalRoute = !!res.isWiredHeadsetPluggedIn;
          _reapplyRoute();
        })
        .catch(() => {});

      if (Platform.OS === "android") {
        // Android: No CallKit, so apply speaker + mic state immediately.
        // Route through _reapplyRoute so we honor any external device
        // already plugged in at this moment.
        _reapplyRoute();
        _isSpeakerOn = _hasExternalRoute ? false : speakerOn;
        InCallManager.setMicrophoneMute(false);
        _isMicMuted = false;
        CT.trace("AUDIO", "audioSession_android_ready", { speakerOn });
      } else {
        // iOS: Defer speaker routing until CallKit activates the audio session.
        // CRITICAL: Don't force speaker — use false (overrideOutputAudioPort(.none))
        // so iOS uses default routing from category options (defaultToSpeaker).
        // This lets headphones/Bluetooth take priority over the built-in speaker.
        // The user can still manually toggle speaker ON via the UI button.
        _pendingSpeakerOn = false;
        _isSpeakerOn = speakerOn; // UI state reflects intent, actual routing deferred
        _isMicMuted = false;
        CT.trace("AUDIO", "audioSession_ios_waiting_for_callkit", {
          pendingSpeaker: false,
          uiSpeaker: speakerOn,
        });
      }

      CT.trace("AUDIO", "audioSession_started", { speakerOn });
      console.log(
        `[AudioSession] Started (speaker=${speakerOn}, platform=${Platform.OS})`,
      );
    } catch (e: any) {
      CT.error("AUDIO", "audioSession_start_failed", { error: e?.message });
      console.error("[AudioSession] Start failed:", e);
    }
  },

  /**
   * Start audio session for Lynk rooms (no CallKit involved).
   * Configures AVAudioSession AND immediately activates it on iOS.
   * Use this instead of start() + setPendingMicStart() for non-call contexts
   * where CallKit will never fire didActivateAudioSession.
   */
  startForLynk(speakerOn: boolean = false): void {
    CT.trace("AUDIO", "audioSession_startForLynk", { speakerOn });
    try {
      _pendingMicStartCallback = null;
      _pendingSpeakerOn = null;

      // Seed the user preference. From here on, _userWantsSpeaker is
      // the "sticky" speaker toggle; external devices (wired / BT)
      // override it at runtime via the route-change listeners below.
      _userWantsSpeaker = speakerOn;

      // Sneaky Lynk rooms are audio-first even when video is enabled.
      // Keep the session in audio/voice-chat mode so remote audio reliably
      // routes and starts. iOS will naturally route to wired headphones
      // or Bluetooth when they're present; we only override with the
      // built-in speaker if the caller explicitly requests speakerOn.
      InCallManager.start({ media: "audio", auto: true });
      _isActive = true;

      if (Platform.OS === "ios") {
        // No CallKit → manually activate the audio session
        RTCAudioSession.audioSessionDidActivate();
        _isCallKitActivated = true;
      }

      // Subscribe to route-change events FIRST so any event that
      // fires between now and the initial probe below is captured.
      _subscribeToRouteChanges();

      // Initial route probe — detect a wired headset NOW (BT on
      // Android arrives via onAudioDeviceChanged; on iOS the
      // AVAudioSession routes naturally to BT through category
      // options, so we don't need an explicit check at start).
      InCallManager.getIsWiredHeadsetPluggedIn()
        .then((res: { isWiredHeadsetPluggedIn: boolean }) => {
          _hasExternalRoute = !!res.isWiredHeadsetPluggedIn;
          _reapplyRoute();
        })
        .catch(() => {
          _hasExternalRoute = false;
          _reapplyRoute();
        });

      // Apply the current preference immediately so the user sees a
      // correct route even before the async probe resolves. The
      // probe's callback above will re-apply with the real answer.
      _reapplyRoute();

      InCallManager.setMicrophoneMute(false);
      _isMicMuted = false;

      CT.trace("AUDIO", "audioSession_lynk_ready", { speakerOn });
      console.log(`[AudioSession] Lynk session ready (speaker=${speakerOn})`);
    } catch (e: any) {
      CT.error("AUDIO", "audioSession_startForLynk_failed", {
        error: e?.message,
      });
      console.error("[AudioSession] startForLynk failed:", e);
    }
  },

  /**
   * Set the user's speaker preference. Call from UI toggles. This is a
   * STICKY preference — the platform's route-change listener will honor
   * it when no external audio device is connected, and defer to
   * plugged wired / BT devices when they are.
   *
   * Prior version (`applySpeakerPreference`) only ran at room start
   * and had no listener for mid-session route changes — plugging
   * headphones in mid-room left audio on the built-in speaker.
   */
  setUserSpeakerPreference(speakerOn: boolean): void {
    _userWantsSpeaker = speakerOn;
    // Re-probe wired state synchronously via the async helper so we
    // don't have to wait for an event to arrive before the preference
    // takes effect.
    InCallManager.getIsWiredHeadsetPluggedIn()
      .then((res: { isWiredHeadsetPluggedIn: boolean }) => {
        _hasExternalRoute = !!res.isWiredHeadsetPluggedIn || _hasExternalRoute;
        _reapplyRoute();
      })
      .catch(() => {
        _reapplyRoute();
      });

    // Android: explicitly route to the preferred speaker device when
    // no external device is holding priority. InCallManager's Android
    // audio device selector is the reliable lever here.
    if (Platform.OS === "android" && !_hasExternalRoute) {
      try {
        InCallManager.chooseAudioRoute(
          speakerOn ? "SPEAKER_PHONE" : "EARPIECE",
        );
      } catch {}
    }
    _reapplyRoute();
    CT.trace("AUDIO", "audioSession_set_speaker_preference", { speakerOn });
  },

  /**
   * Back-compat alias. Old call sites use this name; keep it wired to
   * the new preference-based path so no caller has to change.
   */
  async applySpeakerPreference(speakerOn: boolean): Promise<void> {
    this.setUserSpeakerPreference(speakerOn);
  },

  /**
   * CRITICAL FIX (iOS only): Set a callback that will start the microphone
   * AFTER CallKit activates the audio session. This ensures the mic track
   * is created on an ACTIVE audio session, not a dead one.
   *
   * Call this BEFORE start(), pass a callback that calls microphoneHook.startMicrophone().
   * On Android, the callback is invoked immediately (no CallKit).
   *
   * @param callback - Async function that starts the microphone
   */
  setPendingMicStart(callback: () => Promise<void>): void {
    if (Platform.OS === "android") {
      // Android: No CallKit, invoke immediately
      CT.trace("AUDIO", "mic_start_immediate_android");
      callback().catch((e: any) => {
        CT.error("AUDIO", "mic_start_failed_android", { error: e?.message });
      });
    } else if (_isCallKitActivated) {
      // iOS: CallKit ALREADY activated (race condition — callee answered before
      // joinCall() ran). Invoke immediately since the audio session is live.
      CT.trace("AUDIO", "mic_start_immediate_ios_already_activated");
      console.log(
        "[AudioSession] CallKit already activated — starting mic immediately",
      );
      callback().catch((e: any) => {
        CT.error("AUDIO", "mic_start_failed_ios_late", { error: e?.message });
      });
    } else {
      // iOS: Store for deferred execution in activateFromCallKit()
      _pendingMicStartCallback = callback;
      CT.trace("AUDIO", "mic_start_deferred_ios");
    }
  },

  /**
   * Called ONLY from the CallKeep didActivateAudioSession handler.
   * This is when iOS CallKit has actually activated the audio session
   * and WebRTC can start using it.
   *
   * CRITICAL: This is the moment audio starts flowing on iOS.
   * Without this call, the mic track is created on a dead session.
   *
   * CRITICAL FIX: This now ALSO invokes the pending mic start callback.
   */
  activateFromCallKit(): void {
    CT.trace("AUDIO", "activateFromCallKit_called", {
      wasActive: _isActive,
      wasCallKitActivated: _isCallKitActivated,
      pendingSpeaker: _pendingSpeakerOn ?? undefined,
      hasPendingMicStart: !!_pendingMicStartCallback,
    });

    if (Platform.OS !== "ios") {
      CT.warn("AUDIO", "activateFromCallKit_not_ios");
      return;
    }

    try {
      // Signal WebRTC that the audio session is now active
      RTCAudioSession.audioSessionDidActivate();
      _isCallKitActivated = true;

      // Apply deferred speaker routing now that session is active.
      // CRITICAL: Use overrideOutputAudioPort(.none) by passing false.
      // This lets iOS route to headphones/Bluetooth if connected, falling
      // back to speaker via the defaultToSpeaker category option.
      // setForceSpeakerphoneOn(true) would OVERRIDE headphone routing.
      InCallManager.setForceSpeakerphoneOn(false);
      _isSpeakerOn = false;
      _pendingSpeakerOn = null;

      // Ensure mic is not muted (hardware level)
      InCallManager.setMicrophoneMute(false);
      _isMicMuted = false;

      CT.trace("AUDIO", "activateFromCallKit_done", { speakerOn: false });
      console.log(
        `[AudioSession] CallKit activated — audio session live (speaker=false, headphones take priority)`,
      );

      // CRITICAL FIX: NOW start the microphone (audio track is created on ACTIVE session)
      if (_pendingMicStartCallback) {
        const cb = _pendingMicStartCallback;
        _pendingMicStartCallback = null;
        CT.trace("AUDIO", "invoking_pending_mic_start");
        cb().catch((e: any) => {
          CT.error("AUDIO", "pending_mic_start_failed", { error: e?.message });
        });
      }
    } catch (e: any) {
      CT.error("AUDIO", "activateFromCallKit_failed", { error: e?.message });
      console.error("[AudioSession] activateFromCallKit failed:", e);
    }
  },

  /**
   * Stop in-call audio session. Call on ENDING/ENDED.
   */
  stop(): void {
    if (!_isActive) return;

    CT.trace("AUDIO", "audioSession_stopping");

    try {
      // Tear down route-change listeners FIRST so nothing re-applies
      // a route after we've stopped the session.
      _unsubscribeFromRouteChanges();

      InCallManager.stop();

      if (Platform.OS === "ios") {
        RTCAudioSession.audioSessionDidDeactivate();
      }

      _isActive = false;
      _isCallKitActivated = false;
      _isSpeakerOn = false;
      _isMicMuted = false;
      _pendingSpeakerOn = null;
      _pendingMicStartCallback = null;
      _userWantsSpeaker = false;
      _hasExternalRoute = false;

      CT.trace("AUDIO", "audioSession_stopped");
      console.log("[AudioSession] Stopped");
    } catch (e: any) {
      CT.error("AUDIO", "audioSession_stop_failed", { error: e?.message });
      console.error("[AudioSession] Stop failed:", e);
    }
  },

  /**
   * Set speaker on/off.
   * On iOS, if CallKit hasn't activated yet, stores the value for deferred apply.
   */
  setSpeakerOn(on: boolean): void {
    if (!_isActive) {
      CT.warn("AUDIO", "setSpeakerOn_inactive_attempting", { on });
    }

    // iOS: If CallKit hasn't activated yet, defer
    if (Platform.OS === "ios" && !_isCallKitActivated) {
      _pendingSpeakerOn = on;
      _isSpeakerOn = on; // Update state for UI, actual routing deferred
      CT.trace("SPEAKER", "speaker_deferred_until_callkit", { on });
      console.log(`[AudioSession] Speaker ${on ? "ON" : "OFF"} (deferred)`);
      return;
    }

    try {
      InCallManager.setForceSpeakerphoneOn(on);
      _isSpeakerOn = on;
      CT.trace("SPEAKER", on ? "speaker_enabled" : "speaker_disabled");
      console.log(`[AudioSession] Speaker ${on ? "ON" : "OFF"}`);
    } catch (e: any) {
      CT.error("SPEAKER", "setSpeakerOn_failed", { on, error: e?.message });
      console.error("[AudioSession] setSpeakerOn failed:", e);
    }
  },

  /**
   * Set mic mute on/off. This controls the hardware/OS-level mute.
   * The Fishjam track-level mute (MediaStreamTrack.enabled) is separate
   * and handled by the toggleMute function in use-video-call.ts.
   * Both should be kept in sync.
   */
  setMicMuted(muted: boolean): void {
    if (!_isActive) {
      CT.warn("AUDIO", "setMicMuted_inactive_attempting", { muted });
    }

    try {
      InCallManager.setMicrophoneMute(muted);
      _isMicMuted = muted;
      CT.trace("MUTE", muted ? "mic_muted_hw" : "mic_unmuted_hw");
      console.log(
        `[AudioSession] Mic ${muted ? "MUTED" : "UNMUTED"} (hardware)`,
      );
    } catch (e: any) {
      CT.error("MUTE", "setMicMuted_failed", { muted, error: e?.message });
      console.error("[AudioSession] setMicMuted failed:", e);
    }
  },

  /**
   * Get current state (for DEV HUD / diagnostics).
   */
  getState(): {
    isActive: boolean;
    isCallKitActivated: boolean;
    isSpeakerOn: boolean;
    isMicMuted: boolean;
  } {
    return {
      isActive: _isActive,
      isCallKitActivated: _isCallKitActivated,
      isSpeakerOn: _isSpeakerOn,
      isMicMuted: _isMicMuted,
    };
  },
};
