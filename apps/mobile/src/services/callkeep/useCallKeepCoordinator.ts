/**
 * useCallKeepCoordinator
 *
 * Root-level hook that:
 * 1. Sets up CallKeep on mount
 * 2. Registers CallKeep event listeners ONCE
 * 3. Subscribes to Supabase call_signals and displays native incoming call UI
 * 4. On answer → navigates to call screen, joins Fishjam
 * 5. On end/decline → leaves Fishjam, updates signal status
 *
 * Must be called exactly ONCE from the protected layout.
 */

import { useEffect, useRef } from "react";
import { useRouter } from "expo-router";
import { useAuthStore } from "@/lib/stores/auth-store";
import { supabase } from "@/lib/supabase/client";
import { callSignalsApi, type CallSignal } from "@/lib/api/call-signals";
import {
  setupCallKeep,
  registerCallKeepListeners,
  showIncomingCall,
  endCall,
  reportEndCall,
  setCallActive,
  setMuted,
  persistCallMapping,
  getSessionIdFromUUID,
  clearCallMapping,
  backToForeground,
} from "./callkeep";
import { useVideoRoomStore } from "@/src/video/stores/video-room-store";
import { audioSession } from "@/src/services/calls/audioSession";
import { CT } from "@/src/services/calls/callTrace";

// Track active signal so we can update its status on answer/decline
const _activeSignals = new Map<string, CallSignal>();

// Cooldown: after ending a call, ignore incoming signals for this room
// to prevent "keeps calling back" bug from stale/replayed signals
const _recentlyEndedRooms = new Set<string>();

// ── Mute dedupe lock ────────────────────────────────────────────────
// Prevents feedback loop: UI toggleMute → callKeepSetMuted → didPerformSetMutedCallAction → setMicOn → re-render
// The lock is set when we programmatically call setMuted on CallKeep, and cleared after 500ms.
// During the lock window, inbound CallKeep mute events are ignored.
let _muteLockUntil = 0;

/** Call this before programmatically calling callkeep.setMuted to suppress the echo event. */
export function lockMuteEcho(): void {
  _muteLockUntil = Date.now() + 500;
}

function isMuteLocked(): boolean {
  return Date.now() < _muteLockUntil;
}

export function useCallKeepCoordinator(): void {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const isAuthenticated = useAuthStore((s) => s.isAuthenticated);

  // Use refs to avoid re-registering listeners on every render
  const routerRef = useRef(router);
  routerRef.current = router;

  const userRef = useRef(user);
  userRef.current = user;

  // Track if we've initialized — keyed by userId to allow re-init on auth change
  const initializedForUserRef = useRef<string | null>(null);

  useEffect(() => {
    if (!isAuthenticated || !user?.id) return;
    // Allow re-init if user changed (e.g., logout/login)
    if (initializedForUserRef.current === user.id) return;
    initializedForUserRef.current = user.id;

    let cleanupListeners: (() => void) | undefined;
    let unsubscribeSignals: (() => void) | undefined;
    let signalUpdateChannel: ReturnType<typeof supabase.channel> | null = null;

    const init = async () => {
      // 1. Setup CallKeep
      // REF: https://www.npmjs.com/package/@react-native-oh-tpl/react-native-callkeep
      try {
        await setupCallKeep();
        CT.trace("CALLKEEP", "setupComplete");
      } catch (err: any) {
        CT.error("CALLKEEP", "setupFailed", { error: err?.message });
        return;
      }

      // 2. Register CallKeep event listeners — all wrapped with CT.guard
      cleanupListeners = registerCallKeepListeners({
        onAnswer: ({ callUUID }) => {
          CT.guard(
            "CALLKEEP",
            "onAnswer",
            () => {
              CT.trace("CALLKEEP", "answerPressed", { callUUID });

              const callSessionId = getSessionIdFromUUID(callUUID);
              const signal = _activeSignals.get(callUUID);

              if (signal) {
                callSignalsApi
                  .updateSignalStatus(signal.id, "accepted")
                  .catch((err) =>
                    CT.error("CALLKEEP", "updateSignalFailed", {
                      callUUID,
                      error: String(err),
                    }),
                  );
              }

              setCallActive(callUUID);
              backToForeground();

              // Navigate to call screen — callee joins Fishjam ONLY after this navigation
              // REF: Mandatory principle #3 — MUST NOT join Fishjam until AFTER CallKeep answer
              const roomId = signal?.room_id || callSessionId;
              const callType = signal?.call_type || "video";

              if (roomId) {
                CT.setContext({
                  sessionId: roomId,
                  callUUID,
                  userId: userRef.current?.id,
                });
                CT.trace("LIFECYCLE", "navigatingToCallScreen", {
                  roomId,
                  callType,
                });
                routerRef.current.push({
                  pathname: "/(protected)/call/[roomId]",
                  params: {
                    roomId,
                    callType,
                    isGroup: signal?.is_group ? "true" : "false",
                    recipientUsername: signal?.caller_username || "Unknown",
                    recipientAvatar: signal?.caller_avatar || "",
                  },
                });
              } else {
                CT.error("CALLKEEP", "noRoomIdForUUID", { callUUID });
                endCall(callUUID);
              }
            },
            { callUUID },
          );
        },

        onEnd: ({ callUUID }) => {
          CT.guard(
            "CALLKEEP",
            "onEnd",
            () => {
              CT.trace("CALLKEEP", "endPressed", { callUUID });

              const signal = _activeSignals.get(callUUID);

              if (signal) {
                const status =
                  signal.status === "ringing" ? "declined" : "ended";
                CT.trace("SESSION", "statusChanged", {
                  from: signal.status,
                  to: status,
                  callUUID,
                });
                callSignalsApi
                  .updateSignalStatus(signal.id, status)
                  .catch((err) =>
                    CT.error("CALLKEEP", "updateSignalFailed", {
                      callUUID,
                      error: String(err),
                    }),
                  );
                callSignalsApi.endCallSignals(signal.room_id).catch(() => {});

                // Cooldown: ignore incoming signals for this room for 10s
                // to prevent "keeps calling back" from stale/replayed signals
                _recentlyEndedRooms.add(signal.room_id);
                setTimeout(
                  () => _recentlyEndedRooms.delete(signal.room_id),
                  10000,
                );
              }

              // Also cooldown the callUUID (which is the roomId)
              _recentlyEndedRooms.add(callUUID);
              setTimeout(() => _recentlyEndedRooms.delete(callUUID), 10000);

              // If there's an active Fishjam call, trigger leave
              // The use-video-call.ts external end effect will handle Fishjam cleanup
              const store = useVideoRoomStore.getState();
              if (
                store.callPhase !== "idle" &&
                store.callPhase !== "call_ended"
              ) {
                CT.trace("LIFECYCLE", "externalEnd", {
                  from: store.callPhase,
                  to: "call_ended",
                  callUUID,
                });
                store.setCallPhase("call_ended");
              }

              _activeSignals.delete(callUUID);
              clearCallMapping(callUUID);
              CT.clearContext();
            },
            { callUUID },
          );
        },

        onDidDisplayIncoming: ({ callUUID, error: displayError }) => {
          if (displayError) {
            CT.error("CALLKEEP", "displayIncomingFailed", {
              callUUID,
              error: displayError,
            });
            _activeSignals.delete(callUUID);
            clearCallMapping(callUUID);
          } else {
            CT.trace("CALLKEEP", "displayedIncoming", { callUUID });
          }
        },

        onToggleMute: ({ callUUID, muted }) => {
          CT.guard("AUDIO", "onToggleMute", () => {
            // CRITICAL: Check dedupe lock to prevent feedback loop.
            // When toggleMute() in use-video-call.ts calls callKeepSetMuted(),
            // CallKeep fires didPerformSetMutedCallAction which lands here.
            // Without the lock, we'd re-set the store → re-render → potential loop.
            if (isMuteLocked()) {
              CT.trace("MUTE", "callkeepMuteToggled_IGNORED_locked", {
                callUUID,
                muted,
              });
              return;
            }
            CT.trace("MUTE", "callkeepMuteToggled_fromNativeUI", {
              callUUID,
              muted,
            });
            // This is a genuine user action from the native CallKit/ConnectionService UI
            useVideoRoomStore.getState().setMicOn(!muted);
            audioSession.setMicMuted(muted);
          });
        },

        onAudioSessionActivated: () => {
          CT.guard("AUDIO", "onAudioSessionActivated", () => {
            CT.trace("AUDIO", "audioSessionActivated_fromCallKit");
            // CRITICAL: This is the ONLY place where iOS audio session activation
            // should happen. audioSession.activateFromCallKit() calls
            // RTCAudioSession.audioSessionDidActivate() + applies deferred speaker routing.
            // REF: https://docs.fishjam.io/how-to/react-native/connecting
            audioSession.activateFromCallKit();
          });
        },
      });

      // 3. Subscribe to incoming call signals from Supabase
      // REF: Supabase Realtime postgres_changes for call_signals table
      const userId = user.id;
      CT.trace("CALL", "subscribingToSignals", { userId });
      unsubscribeSignals = callSignalsApi.subscribeToIncomingCalls(
        userId,
        (signal: CallSignal) => {
          CT.guard("CALL", "incomingSignalHandler", () => {
            // Cooldown: ignore signals for rooms we just ended
            if (_recentlyEndedRooms.has(signal.room_id)) {
              CT.trace("CALL", "incomingIgnored_recentlyEnded", {
                roomId: signal.room_id,
              });
              console.log(
                "[CallKeep] Ignoring incoming signal for recently ended room:",
                signal.room_id,
              );
              return;
            }

            // Ignore if we're already in an active call
            const currentPhase = useVideoRoomStore.getState().callPhase;
            if (
              currentPhase !== "idle" &&
              currentPhase !== "call_ended" &&
              currentPhase !== "error"
            ) {
              CT.trace("CALL", "incomingIgnored_activeCall", {
                roomId: signal.room_id,
                currentPhase,
              });
              console.log(
                "[CallKeep] Ignoring incoming signal — already in call phase:",
                currentPhase,
              );
              return;
            }

            CT.trace("CALL", "incomingDetected", {
              caller: signal.caller_username ?? undefined,
              roomId: signal.room_id,
              callType: signal.call_type,
            });

            // Use room_id as the UUID since it's unique per call session
            const callUUID = signal.room_id;

            persistCallMapping(signal.room_id, callUUID);
            _activeSignals.set(callUUID, signal);

            // Display native incoming call UI
            // REF: Mandatory principle #3 — MUST NOT join Fishjam here, only show UI
            // REF: https://www.npmjs.com/package/@react-native-oh-tpl/react-native-callkeep
            showIncomingCall({
              callUUID,
              handle: signal.caller_username || "Unknown",
              displayName: signal.caller_username || "Unknown Caller",
              hasVideo: signal.call_type === "video",
            });
            CT.trace("CALLKEEP", "showIncomingCalled", {
              callUUID,
              hasVideo: signal.call_type === "video",
            });
          });
        },
      );

      // 4. Subscribe to signal UPDATEs — dismiss CallKeep UI on missed/ended/declined
      // When the caller's ring timeout fires and marks the signal as "missed",
      // or when the caller hangs up (status → "ended"), we need to dismiss
      // the native ringing UI on the callee's device.
      signalUpdateChannel = supabase
        .channel(`call_signal_updates:${userId}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "call_signals",
            filter: `callee_id=eq.${userId}`,
          },
          (payload) => {
            const updated = payload.new as CallSignal;
            CT.guard("CALL", "signalUpdateHandler", () => {
              if (
                updated.status === "missed" ||
                updated.status === "ended" ||
                updated.status === "declined"
              ) {
                const callUUID = updated.room_id;
                const activeSignal = _activeSignals.get(callUUID);

                if (activeSignal) {
                  CT.trace("CALL", "signalDismissed", {
                    roomId: updated.room_id,
                    status: updated.status,
                  });
                  console.log(
                    `[CallKeep] Signal ${updated.status} — dismissing incoming call UI for room:`,
                    updated.room_id,
                  );

                  // Dismiss the native CallKeep ringing UI
                  reportEndCall(callUUID, "REMOTE_ENDED");
                  _activeSignals.delete(callUUID);
                  clearCallMapping(callUUID);
                }
              }
            });
          },
        )
        .subscribe((status) => {
          CT.trace("CALL", "signalUpdateSubscription", { status });
        });
    };

    init();

    return () => {
      initializedForUserRef.current = null;
      cleanupListeners?.();
      unsubscribeSignals?.();
      if (signalUpdateChannel) {
        supabase.removeChannel(signalUpdateChannel);
      }
      _activeSignals.clear();
    };
  }, [isAuthenticated, user?.id]);
}
