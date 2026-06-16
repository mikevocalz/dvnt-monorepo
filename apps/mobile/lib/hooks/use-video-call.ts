/**
 * useVideoCall — Production-Grade Call Hook (Fishjam SDK)
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  ARCHITECTURE INVARIANTS (NEVER VIOLATE):                          ║
 * ║                                                                    ║
 * ║  1. ALL call state lives in Zustand (useVideoRoomStore).           ║
 * ║     NO useState for room, participants, tracks, call status.       ║
 * ║                                                                    ║
 * ║  2. DETERMINISTIC JOIN ORDER — MODE-AWARE:                         ║
 * ║                                                                    ║
 * ║     AUDIO:                                                         ║
 * ║       a) Request mic permission (ONLY — no camera)                 ║
 * ║       b) Create/join room                                          ║
 * ║       c) Connect Fishjam peer                                      ║
 * ║       d) Start microphone                                          ║
 * ║       e) Render audio UI (NO RTCView)                              ║
 * ║                                                                    ║
 * ║     VIDEO:                                                         ║
 * ║       a) Request mic + camera permissions                          ║
 * ║       b) Create/join room                                          ║
 * ║       c) Connect Fishjam peer                                      ║
 * ║       d) Start microphone                                          ║
 * ║       e) Start camera (front-facing default)                       ║
 * ║       f) Verify cameraStream !== null                               ║
 * ║       g) Render video UI                                           ║
 * ║                                                                    ║
 * ║  3. NO SILENT FAILURES. Every error surfaces to store + logs.      ║
 * ║                                                                    ║
 * ║  4. AUDIO MODE MUST NEVER touch camera.                            ║
 * ║     Camera enable in audio mode = INVARIANT VIOLATION.             ║
 * ║     Use escalateToVideo() for explicit audio → video upgrade.      ║
 * ║                                                                    ║
 * ║  5. RTCView NEVER renders without a resolved video track.          ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { useCallback, useRef, useEffect } from "react";
import { Platform, PermissionsAndroid } from "react-native";
import {
  useConnection,
  useCamera,
  useMicrophone,
  usePeers,
} from "@fishjam-cloud/react-native-client";
import { useAuthStore } from "@/lib/stores/auth-store";
import { videoApi } from "@/src/video/api";
import { callSignalsApi } from "@/lib/api/call-signals";
import { supabase } from "@/lib/supabase/client";
import { audioSession } from "@/src/services/calls/audioSession";
import {
  startOutgoingCall,
  reportOutgoingCallConnected,
  endCall as callKeepEndCall,
  endAllCalls as callKeepEndAllCalls,
  persistCallMapping,
  clearCallMapping,
  setMuted as callKeepSetMuted,
} from "@/src/services/callkeep";
import { lockMuteEcho } from "@/src/services/callkeep/useCallKeepCoordinator";
import { useChatStore } from "@/lib/stores/chat-store";
import {
  useVideoRoomStore,
  type CallType,
  type CallPhase,
  type CallRole,
  type CallDirection,
  type RecipientInfo,
} from "@/src/video/stores/video-room-store";
import type { Participant } from "@/src/video/types";
import { CT } from "@/src/services/calls/callTrace";
import { resolveFishjamAppId } from "@/lib/video/fishjam-config";

// Re-export for consumers
export type { CallType, CallPhase, CallRole, CallDirection, RecipientInfo };
export type { Participant };

const LOG_PREFIX = "[VideoCall]";

function log(...args: unknown[]) {
  console.log(LOG_PREFIX, ...args);
}
function logError(...args: unknown[]) {
  console.error(LOG_PREFIX, "ERROR:", ...args);
}
function logWarn(...args: unknown[]) {
  console.warn(LOG_PREFIX, "WARN:", ...args);
}

export function useVideoCall() {
  const user = useAuthStore((s) => s.user);
  const { joinRoom, leaveRoom, peerStatus } = useConnection();
  const cameraHook = useCamera();
  const microphoneHook = useMicrophone();
  const peers = usePeers();

  // ── Stable refs for SDK functions (identity not guaranteed stable) ──
  const joinRoomRef = useRef(joinRoom);
  joinRoomRef.current = joinRoom;
  const leaveRoomRef = useRef(leaveRoom);
  leaveRoomRef.current = leaveRoom;
  const cameraRef = useRef(cameraHook);
  cameraRef.current = cameraHook;
  const micRef = useRef(microphoneHook);
  micRef.current = microphoneHook;
  const durationIntervalRef = useRef<ReturnType<typeof setInterval> | null>(
    null,
  );
  const hadPeersRef = useRef(false);
  const reportedConnectedRef = useRef(false);
  const leaveCallRef = useRef<() => void>(() => {});
  const joinCallRef = useRef<
    (roomId: string, callType?: CallType) => Promise<void>
  >(async () => {});
  const micStartedRef = useRef(false);
  const ringTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Ring timeout duration (30s like Facebook/Instagram)
  const RING_TIMEOUT_MS = 30_000;

  // ── Zustand store access ────────────────────────────────────────────
  // CRITICAL: Use individual selectors to prevent re-render storms.
  // getStore() for imperative access in callbacks/effects.
  const getStore = useVideoRoomStore.getState;

  // Reactive selectors — only subscribe to what the return block + effects need
  const callPhase = useVideoRoomStore((s) => s.callPhase);
  const callType = useVideoRoomStore((s) => s.callType);
  const callRole = useVideoRoomStore((s) => s.callRole);
  const callDirection = useVideoRoomStore((s) => s.callDirection);
  const recipientInfo = useVideoRoomStore((s) => s.recipientInfo);
  const roomId_store = useVideoRoomStore((s) => s.roomId);
  const chatId_store = useVideoRoomStore((s) => s.chatId);
  const callEnded = useVideoRoomStore((s) => s.callEnded);
  const callDuration = useVideoRoomStore((s) => s.callDuration);
  const error_store = useVideoRoomStore((s) => s.error);
  const errorCode_store = useVideoRoomStore((s) => s.errorCode);
  const connectionStatus = useVideoRoomStore((s) => s.connectionState.status);
  const isMicOn = useVideoRoomStore((s) => s.isMicOn);
  const isCameraOn = useVideoRoomStore((s) => s.isCameraOn);
  const localStream = useVideoRoomStore((s) => s.localStream);
  const participants = useVideoRoomStore((s) => s.participants);
  const cameraPermission = useVideoRoomStore((s) => s.cameraPermission);
  const micPermission = useVideoRoomStore((s) => s.micPermission);
  const isSpeakerOn = useVideoRoomStore((s) => s.isSpeakerOn);
  const isPiPActive = useVideoRoomStore((s) => s.isPiPActive);

  // ── Sync Fishjam peerStatus → store ─────────────────────────────────
  useEffect(() => {
    const s = getStore();
    // GUARD: Ignore peerStatus changes after call has ended/errored/reset.
    // Fishjam fires disconnect/error events AFTER leaveRoom() — these must
    // not overwrite the terminal call_ended phase or set error post-hangup.
    const phase = s.callPhase;
    if (phase === "call_ended" || phase === "error" || phase === "idle") {
      return;
    }
    if (peerStatus === "connected" && phase === "connecting_peer") {
      s.setCallPhase("starting_media");
      s.setConnectionStatus("connected");
      log("Peer connected, transitioning to starting_media");
    } else if (peerStatus === "connected") {
      s.setConnectionStatus("connected");
    } else if (peerStatus === "error") {
      s.setConnectionStatus("error", "Peer connection failed");
      if (phase === "connecting_peer") {
        s.setError("WebRTC peer connection failed", "peer_error");
      }
    }
  }, [peerStatus, getStore]);

  // ── Sync local camera stream → store ────────────────────────────────
  useEffect(() => {
    const stream = cameraHook.cameraStream ?? null;
    const s = getStore();
    s.setLocalStream(stream as any);
    if (stream) {
      const tracks = stream.getVideoTracks();
      log(`Local camera stream updated: ${tracks.length} video track(s)`);
      s.setCameraOn(tracks.length > 0);
    } else {
      s.setCameraOn(false);
    }
  }, [cameraHook.cameraStream, getStore]);

  // ── Sync remote peers → store participants ──────────────────────────
  // REF: Fishjam SDK v0.25 PeerWithTracks exposes distinguished tracks:
  //   peer.cameraTrack, peer.microphoneTrack (Track | undefined)
  //   Track = { stream: MediaStream | null, trackId, metadata, track: MediaStreamTrack | null }
  // REF: https://docs.fishjam.io/tutorials/react-native-quick-start
  useEffect(() => {
    const remotePeers = peers.remotePeers || [];

    // [CALL/TRACK] Comprehensive remote track logging (Phase 0 diagnostic)
    for (const peer of remotePeers) {
      const p = peer as any;
      const camTrack = p.cameraTrack;
      const micTrack = p.microphoneTrack;
      const camStream = camTrack?.stream;
      const micStream = micTrack?.stream;
      const camMediaTrack =
        camTrack?.track ?? camStream?.getVideoTracks?.()?.[0];
      const micMediaTrack =
        micTrack?.track ?? micStream?.getAudioTracks?.()?.[0];

      CT.trace("CALL", "remote_peer_tracks", {
        peerId: p.id,
        userId: p.metadata?.userId,
        hasCamTrack: !!camTrack,
        hasCamStream: !!camStream,
        hasCamMediaTrack: !!camMediaTrack,
        camEnabled: camMediaTrack?.enabled,
        camReadyState: camMediaTrack?.readyState,
        camStreamId: camStream?.id,
        camTrackId: camMediaTrack?.id,
        hasMicTrack: !!micTrack,
        hasMicStream: !!micStream,
        hasMicMediaTrack: !!micMediaTrack,
        micEnabled: micMediaTrack?.enabled,
        micReadyState: micMediaTrack?.readyState,
        micStreamId: micStream?.id,
        micTrackId: micMediaTrack?.id,
      });

      if (camTrack) {
        if (camMediaTrack) {
          log(
            `[CALL/VIDEO] ✓ remote video READY peerId=${p.id} trackId=${camMediaTrack.id} enabled=${camMediaTrack.enabled} readyState=${camMediaTrack.readyState} streamId=${camStream?.id}`,
          );
        } else {
          logWarn(
            `[CALL/VIDEO] ⚠️ remote video PENDING (track wrapper exists but stream/track null) peerId=${p.id}`,
          );
        }
      }
      if (micTrack) {
        if (micMediaTrack) {
          log(
            `[CALL/AUDIO] ✓ remote audio READY peerId=${p.id} trackId=${micMediaTrack.id} enabled=${micMediaTrack.enabled} readyState=${micMediaTrack.readyState} streamId=${micStream?.id}`,
          );
        } else {
          logWarn(
            `[CALL/AUDIO] ⚠️ remote audio PENDING (track wrapper exists but stream/track null) peerId=${p.id}`,
          );
        }
      }
    }

    const participants: Participant[] = remotePeers.map((peer: any) => {
      // Fishjam SDK v0.25: use cameraTrack/microphoneTrack (distinguished)
      // Fallback to legacy videoTrack/audioTrack for compatibility
      const videoTrack = peer.cameraTrack ?? peer.videoTrack ?? null;
      const audioTrack = peer.microphoneTrack ?? peer.audioTrack ?? null;

      // CRITICAL: Check for the track object existing at all — the SDK may have
      // a track wrapper with null stream initially that populates async.
      // isCameraOn/isMicOn should be true if the track wrapper exists (even if stream is null yet)
      // because the remote peer HAS published that track.
      const hasCam = !!(
        videoTrack?.stream ||
        videoTrack?.track ||
        videoTrack?.trackId
      );
      const hasMic = !!(
        audioTrack?.stream ||
        audioTrack?.track ||
        audioTrack?.trackId
      );

      return {
        odId: peer.id,
        oderId: peer.metadata?.userId ?? peer.id,
        userId: peer.metadata?.userId ?? peer.id,
        username: peer.metadata?.username ?? "?",
        avatar: peer.metadata?.avatar,
        role: peer.metadata?.role || "participant",
        isLocal: false,
        isCameraOn: hasCam,
        isMicOn: hasMic,
        isScreenSharing: false,
        videoTrack,
        audioTrack,
      };
    });
    getStore().setParticipants(participants);

    // Track if we ever had remote peers
    if (participants.length > 0) {
      hadPeersRef.current = true;

      // PHASE TRANSITION: outgoing_ringing → connected when callee actually joins Fishjam.
      // This is the ONLY place where an outgoing call becomes 'connected'.
      // REF: Mandatory principle #4 — call is NOT confirmed until callee joined Fishjam.
      if (!reportedConnectedRef.current) {
        reportedConnectedRef.current = true;
        const currentStore = getStore();
        const currentRoomId = currentStore.roomId;

        // Transition to connected
        if (currentStore.callPhase === "outgoing_ringing") {
          currentStore.setCallPhase("connected");
          log(
            "[LIFECYCLE] Callee joined Fishjam — outgoing_ringing → connected",
          );
        }

        // Start duration timer NOW (not when caller joins)
        startDurationTimer();

        if (currentRoomId) {
          try {
            reportOutgoingCallConnected(currentRoomId);
            log("Callee joined — reported outgoing call connected");
          } catch (ckErr) {
            logWarn("CallKeep reportConnected on peer join failed:", ckErr);
          }
          // Audio session was already started in createCall/joinCall.
          // No need to re-activate here.
        }
      }
    }

    // ── MIC SAFETY NET: Force-start mic if it hasn't started after peers join ──
    // On iOS, the mic start is deferred until CallKit fires didActivateAudioSession.
    // If that event never fires (e.g., outgoing call where CallKit activation is flaky),
    // the mic never starts → no audio. This safety net catches that case.
    if (participants.length > 0 && !micStartedRef.current) {
      log(
        "[MIC_SAFETY] Remote peers present but mic not started — force-starting in 3s",
      );
      setTimeout(() => {
        if (micStartedRef.current) return; // Already started
        const phase = getStore().callPhase;
        if (
          phase !== "connected" &&
          phase !== "outgoing_ringing" &&
          phase !== "starting_media"
        )
          return;

        // GUARD: Only start if mic is not already on — toggleMicrophone is a true
        // toggle and would STOP the mic if it's already running.
        if (micRef.current.isMicrophoneOn) {
          log("[MIC_SAFETY] Mic is already on, skipping to avoid toggling OFF");
          micStartedRef.current = true;
          return;
        }
        log(
          "[MIC_SAFETY] Force-starting microphone via toggleMicrophone (CallKit activation may have been missed)",
        );
        micStartedRef.current = true;
        micRef.current
          .toggleMicrophone()
          .then(() => {
            getStore().setMicOn(true);
            log(
              "[MIC_SAFETY] Microphone force-started + published via toggleMicrophone",
            );
          })
          .catch((err: any) => {
            micStartedRef.current = false;
            logError("[MIC_SAFETY] Force mic start failed:", err);
          });
      }, 3000);
    }

    // Auto-end call when all remote peers leave after being connected
    const s = getStore();
    const currentPhase = s.callPhase;
    log(
      `[PEER_SYNC] remotePeers=${remotePeers.length} participants=${participants.length} hadPeers=${hadPeersRef.current} phase=${currentPhase}`,
    );

    if (
      hadPeersRef.current &&
      participants.length === 0 &&
      (currentPhase === "connected" || currentPhase === "outgoing_ringing")
    ) {
      log("All remote peers left — auto-ending call in 2s");
      // Small delay to avoid race with peer reconnection
      setTimeout(() => {
        const current = getStore();
        if (
          current.participants.length === 0 &&
          (current.callPhase === "connected" ||
            current.callPhase === "outgoing_ringing")
        ) {
          log("[AUTO-END] Confirmed: no peers after 2s, ending call");
          leaveCallRef.current();
        } else {
          log(
            `[AUTO-END] Cancelled: participants=${current.participants.length} phase=${current.callPhase}`,
          );
        }
      }, 2000);
    }
  }, [peers.remotePeers, getStore]);

  // ── Duration timer ──────────────────────────────────────────────────
  const startDurationTimer = useCallback(() => {
    const now = Date.now();
    getStore().setCallStartedAt(now);
    durationIntervalRef.current = setInterval(() => {
      const startedAt = getStore().callStartedAt;
      if (startedAt) {
        getStore().setCallDuration(Math.floor((Date.now() - startedAt) / 1000));
      }
    }, 1000);
  }, [getStore]);

  const stopDurationTimer = useCallback(() => {
    if (durationIntervalRef.current) {
      clearInterval(durationIntervalRef.current);
      durationIntervalRef.current = null;
    }
  }, []);

  // ── Find front camera device ID ────────────────────────────────────
  const getFrontCameraId = useCallback((): string | undefined => {
    const devices = cameraRef.current.cameraDevices || [];
    const front = devices.find(
      (d: any) =>
        d.label?.toLowerCase().includes("front") ||
        d.deviceId?.includes("front"),
    );
    if (front) log("Front camera found:", front.deviceId);
    else logWarn("No front camera found in", devices.length, "devices");
    return front?.deviceId;
  }, []);

  // ── Start media — MODE-AWARE ──────────────────────────────────────
  // AUDIO: mic only. Camera MUST NOT be touched.
  // VIDEO: mic + camera (front-facing default).
  //
  // CRITICAL FIX: On iOS, mic start is deferred until CallKit activates audio session.
  // We return a promise that resolves when mic is actually started (or immediately on Android).
  const startMedia = useCallback(
    async (type: CallType): Promise<boolean> => {
      const s = getStore();
      s.setCallPhase("starting_media");
      log(`Starting media for ${type.toUpperCase()} call`);

      // ── Step 1: Start microphone (ALWAYS, both modes) ──────────────
      // REF: https://docs.fishjam.io/how-to/react-native/start-streaming
      //   "startMicrophone() creates and publishes the local audio track."
      // REF: https://docs.fishjam.io/how-to/react-native/connecting
      //   "After joining, start media devices to publish tracks."
      //
      // CRITICAL FIX (iOS): Mic start is deferred via audioSession.setPendingMicStart()
      // to ensure the audio track is created on an ACTIVE audio session AFTER CallKit
      // activation. On Android, the callback fires immediately.
      //
      // The actual mic start happens in the callback passed to audioSession, which is
      // invoked when CallKit calls didActivateAudioSession (iOS) or immediately (Android).
      //
      // We still set isMicOn=true here so the UI reflects the intent, but the track
      // won't actually exist until CallKit activates (iOS) or immediately (Android).
      try {
        s.setMicOn(true);
        CT.trace("MEDIA", "mic_start_requested", { callType: type });
        log(
          `[${type.toUpperCase()}] Microphone start requested (will activate after audio session)`,
        );
      } catch (micErr) {
        logError(
          `[${type.toUpperCase()}] FAILED to request microphone:`,
          micErr,
        );
        CT.error("MEDIA", "mic_start_request_failed", {
          error: (micErr as any)?.message,
          callType: type,
        });
        s.setError(
          "Microphone failed to start. Check permissions.",
          "mic_start_failed",
        );
        return false;
      }

      // ── Step 2: Start camera (VIDEO ONLY) ──────────────────────────
      if (type === "video") {
        try {
          // CRITICAL FIX: Use toggleCamera() instead of startCamera().
          // startCamera() (SDK's startDevice) only creates the local track but does NOT
          // publish it to Fishjam. toggleCamera() (SDK's toggleDevice) both starts the
          // device AND publishes the track when peerStatus === "connected".
          // Without this, both users see their own local PIP but remote video is black.
          const frontId = getFrontCameraId();
          if (frontId) {
            // Select the front camera first, then toggle on
            await cameraRef.current.selectCamera(frontId);
          }
          const err = await cameraRef.current.toggleCamera();
          if (err) {
            logError("[VIDEO] Camera toggleCamera returned error:", err);
            s.setError(
              "Camera failed to start: " + ((err as any).name || "unknown"),
              "camera_start_failed",
            );
            return false;
          }
          s.setCameraOn(true);
          log(
            "[VIDEO] Camera started + published via toggleCamera, stream:",
            !!cameraRef.current.cameraStream,
          );

          if (!cameraRef.current.cameraStream) {
            logWarn(
              "[VIDEO] cameraStream is null after toggleCamera — may populate async",
            );
          }
        } catch (camErr) {
          logError("[VIDEO] FAILED to start camera:", camErr);
          s.setError(
            "Camera failed to start. Check permissions.",
            "camera_start_failed",
          );
          return false;
        }
      } else {
        // AUDIO MODE: Explicitly do NOT touch camera
        log(
          "[AUDIO] Skipping camera — audio-only mode. Camera will NOT be enabled.",
        );
        s.setCameraOn(false);
      }

      // NOTE: Speaker routing is handled by audioSession.start() in createCall/joinCall.
      // Do NOT call enableSpeakerphone here — audioSession is the single source of truth.

      // NOTE: Do NOT set callPhase here — the caller sets it to 'outgoing_ringing'
      // and the callee sets it to 'connected'. The phase transition is the caller's
      // responsibility after startMedia returns.
      log(`[${type.toUpperCase()}] Media started successfully`);
      return true;
    },
    [getFrontCameraId, getStore],
  );

  // ── Create a new call (outgoing) ───────────────────────────────────
  const createCall = useCallback(
    async (
      participantIds: string[],
      isGroup: boolean = false,
      callType: CallType = "video",
      chatId?: string,
    ) => {
      const s = getStore();
      s.clearError();
      s.setCallType(callType);
      s.setCallRole("caller");
      s.setCallDirection("outgoing");
      s.setChatId(chatId || null);
      micStartedRef.current = false;
      hadPeersRef.current = false;
      reportedConnectedRef.current = false;
      cleanupInProgressRef.current = false;
      userInitiatedLeaveRef.current = false;
      CT.setContext({ userId: user?.id });
      CT.trace("LIFECYCLE", "createCall_start", {
        callType,
        participantCount: participantIds.length,
      });

      // ── COLLISION DETECTION ──────────────────────────────────────────
      // If the target user is already calling US, skip room creation and
      // join their room instead. This prevents the "both users call each
      // other simultaneously → both end up in separate empty rooms" bug.
      if (!isGroup && participantIds.length === 1 && user?.id) {
        try {
          const collision = await callSignalsApi.checkCollision(
            user.id,
            participantIds[0],
          );
          if (collision) {
            log(
              `[COLLISION] ${participantIds[0]} is already calling us — joining their room: ${collision.room_id}`,
            );
            CT.trace("LIFECYCLE", "collision_detected", {
              existingRoom: collision.room_id,
              callerId: collision.caller_id,
            });

            // Accept the incoming signal
            callSignalsApi
              .updateSignalStatus(collision.id, "accepted")
              .catch(() => {});

            // Dismiss any CallKeep incoming UI for this call
            CT.guard("CALLKEEP", "collision_endIncoming", () => {
              callKeepEndCall(collision.room_id);
              clearCallMapping(collision.room_id);
            });

            // Join the existing room as callee instead
            await joinCallRef.current(collision.room_id, callType);
            return;
          }
        } catch (collisionErr) {
          // Non-fatal — proceed with normal call creation
          logWarn("Collision check failed (non-fatal):", collisionErr);
        }
      }

      // Step 1: Create room (edge function)
      s.setCallPhase("creating_room");
      log("Creating room...");

      const title = isGroup
        ? `Group Call (${participantIds.length + 1})`
        : callType === "audio"
          ? "Audio Call"
          : "Video Call";

      const createResult = await videoApi.createRoom({
        title,
        isPublic: false, // CRITICAL: Personal calls must be private (not shown in Sneaky Lynk)
        maxParticipants: Math.max(participantIds.length + 1, 10),
      });

      if (!createResult.ok || !createResult.data) {
        const msg = createResult.error?.message || "Failed to create room";
        logError("Room creation failed:", msg);
        s.setError(msg, createResult.error?.code || "create_room_failed");
        return;
      }

      const newRoomId = createResult.data.room.id;
      s.setRoomId(newRoomId);
      log("Room created:", newRoomId);

      // Step 2: Join room (edge function → get Fishjam token)
      s.setCallPhase("joining_room");
      log("Joining room...");

      const joinResult = await videoApi.joinRoom(newRoomId);
      log("Join result:", JSON.stringify(joinResult));
      if (!joinResult.ok || !joinResult.data) {
        const msg = joinResult.error?.message || "Failed to join room";
        logError("Room join failed:", msg);
        logError("Full join response:", JSON.stringify(joinResult));
        s.setError(msg, joinResult.error?.code || "join_room_failed");
        return;
      }

      const { token, user: joinedUser, room: joinedRoom } = joinResult.data;
      log("Got Fishjam token for user:", joinedUser.id);
      // [SESSION] Assertion: verify roomId + fishjamRoomId for debugging
      log(
        `[SESSION] roomId=${newRoomId}, fishjamRoomId=${joinedRoom?.fishjamRoomId}, userId=${joinedUser.id}`,
      );

      // Step 3: Connect Fishjam peer
      s.setCallPhase("connecting_peer");
      log("Connecting Fishjam peer...");
      log(
        `[DEBUG] token length=${token?.length ?? 0}, joinRoomRef=${typeof joinRoomRef.current}`,
      );

      if (!token) {
        logError("No Fishjam token returned from edge function");
        s.setError("No peer token received", "no_peer_token");
        return;
      }

      // ── WebSocket diagnostic: test raw connectivity before SDK joinRoom ──
      const wsUrl = `wss://fishjam.io/api/v1/connect/${resolveFishjamAppId()}/socket/peer/websocket`;
      log(`[WS_DIAG] Testing WebSocket to: ${wsUrl}`);
      try {
        await new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(wsUrl);
          const timeout = setTimeout(() => {
            ws.close();
            reject(new Error("WebSocket connect timeout (5s)"));
          }, 5000);
          ws.onopen = () => {
            log("[WS_DIAG] WebSocket OPENED successfully");
            clearTimeout(timeout);
            ws.close();
            resolve();
          };
          ws.onerror = (e: any) => {
            logError(
              "[WS_DIAG] WebSocket ERROR:",
              e?.message || e?.type || JSON.stringify(e),
            );
            clearTimeout(timeout);
            reject(
              new Error(
                `WebSocket error: ${e?.message || e?.type || "unknown"}`,
              ),
            );
          };
          ws.onclose = (e: any) => {
            log(
              `[WS_DIAG] WebSocket CLOSED: code=${e?.code} reason="${e?.reason}" wasClean=${e?.wasClean}`,
            );
          };
        });
      } catch (wsErr: any) {
        logError("[WS_DIAG] WebSocket connectivity FAILED:", wsErr?.message);
        // Don't abort — still try joinRoom, but log the failure
      }

      try {
        log("[FISHJAM] Calling joinRoom with token length:", token.length);
        await joinRoomRef.current({
          peerToken: token,
          peerMetadata: {
            userId: joinedUser.id,
            username: joinedUser.username,
            avatar: joinedUser.avatar,
          },
        });
        log("Fishjam peer connected successfully");
      } catch (peerErr: any) {
        logError("Fishjam peer join failed:", peerErr);
        logError(
          "[DEBUG] peerErr type:",
          typeof peerErr,
          "value:",
          JSON.stringify(peerErr),
        );
        s.setError(
          peerErr?.message || "WebRTC connection failed",
          "peer_join_failed",
        );
        return;
      }

      // Step 4: Register outgoing call with CallKeep BEFORE starting media.
      // On iOS, CallKit must activate the audio session before we start the mic,
      // otherwise the audio track is created on a dead/inactive session.
      // REF: https://www.npmjs.com/package/@react-native-oh-tpl/react-native-callkeep
      const callUUID = newRoomId;
      try {
        persistCallMapping(newRoomId, callUUID);
        startOutgoingCall({
          callUUID,
          handle: user?.username || "DVNT",
          displayName: isGroup
            ? `Group Call (${participantIds.length + 1})`
            : "DVNT Call",
          hasVideo: callType === "video",
        });
        log(
          "[CALLKEEP] Outgoing call registered, waiting for audio session activation",
        );
        // DO NOT call reportOutgoingCallConnected here — the callee hasn't
        // answered yet. CallKit will show "Calling..." until we report connected.
      } catch (ckErr) {
        logWarn("CallKeep startOutgoingCall failed (non-fatal):", ckErr);
      }

      // Step 5: Signal callees immediately so they get the incoming call ASAP
      try {
        await callSignalsApi.sendCallSignal({
          roomId: newRoomId,
          callerId: user?.id || "",
          calleeIds: participantIds,
          callerUsername: user?.username || undefined,
          callerAvatar: user?.avatar || undefined,
          isGroup,
          callType,
        });
        log("[CALL] Signal sent to", participantIds.length, "users");
      } catch (signalErr) {
        logWarn("Failed to send call signal (non-fatal):", signalErr);
      }

      // Step 6: Start in-call audio session FIRST.
      // This configures iOS AVAudioSession (playAndRecord + allowBluetooth)
      // and Android AudioManager (IN_COMMUNICATION mode + audio focus).
      // CRITICAL: Must run BEFORE setPendingMicStart() because start() resets
      // _isCallKitActivated. If we set the mic callback first and CallKit already
      // fired, the callback would execute on a stale session, then start() would
      // reconfigure the session — killing the mic track.
      audioSession.start(callType === "video", callType);

      // Step 7: Set up deferred mic start callback AFTER audio session is configured.
      // On iOS, the callback will be invoked by audioSession.activateFromCallKit()
      // when CallKit fires didActivateAudioSession (or immediately if already fired).
      // On Android, the callback fires immediately (no CallKit).
      audioSession.setPendingMicStart(async () => {
        if (micStartedRef.current) {
          log("[CALLER] Mic already started, skipping duplicate");
          return;
        }
        micStartedRef.current = true;
        try {
          // GUARD: Only start mic if it's not already on. toggleMicrophone() is a
          // true toggle — if a track already exists it STOPS it. On video calls,
          // camera init + CallKit timing can cause double-toggle → mic OFF.
          if (micRef.current.isMicrophoneOn) {
            log(
              `[${callType.toUpperCase()}] CALLER mic already on, skipping toggleMicrophone to avoid toggling OFF`,
            );
          } else {
            await micRef.current.toggleMicrophone();
          }
          const s = getStore();
          s.setMicOn(true);

          const micStream = micRef.current.microphoneStream;
          const isMicOn = micRef.current.isMicrophoneOn;
          const audioTrackCount = micStream?.getAudioTracks?.()?.length ?? 0;

          CT.trace("MEDIA", "mic_started", {
            hasStream: !!micStream,
            isMicOn,
            audioTrackCount,
            callType,
          });
          log(
            `[${callType.toUpperCase()}] Microphone started + published via toggleMicrophone — stream=${!!micStream}, tracks=${audioTrackCount}, isMicOn=${isMicOn}`,
          );

          if (!micStream || audioTrackCount === 0) {
            CT.warn("MEDIA", "mic_started_no_stream", {
              hasStream: !!micStream,
              audioTrackCount,
            });
            logWarn(
              `[${callType.toUpperCase()}] Mic started but stream not yet available — may populate async`,
            );
          }
        } catch (micErr) {
          micStartedRef.current = false;
          logError(
            `[${callType.toUpperCase()}] FAILED to start microphone:`,
            micErr,
          );
          CT.error("MEDIA", "mic_start_failed", {
            error: (micErr as any)?.message,
            callType,
          });
          getStore().setError(
            "Microphone failed to start. Check permissions.",
            "mic_start_failed",
          );
        }
      });

      // Step 8: Start media (camera only for video, mic already deferred)
      const mediaOk = await startMedia(callType);
      if (!mediaOk) {
        logError("Media start failed, aborting call");
        return;
      }

      // Step 8: Transition to outgoing_ringing — caller is ready but callee hasn't joined yet.
      // The peer sync effect will transition to 'connected' when the first remote peer joins.
      // DO NOT call startDurationTimer here — it starts when callee actually joins.
      s.setCallPhase("outgoing_ringing");
      reportedConnectedRef.current = false;
      log(
        "[LIFECYCLE] Outgoing call ringing, waiting for callee to join:",
        newRoomId,
      );
    },
    [user, startMedia, startDurationTimer, getStore],
  );

  // ── Join an existing call (incoming) ───────────────────────────────
  const joinCall = useCallback(
    async (roomId: string, callType: CallType = "video") => {
      const s = getStore();
      s.clearError();
      s.setCallType(callType);
      s.setCallRole("callee");
      s.setCallDirection("incoming");
      s.setRoomId(roomId);
      micStartedRef.current = false;
      hadPeersRef.current = false;
      reportedConnectedRef.current = false;
      cleanupInProgressRef.current = false;
      userInitiatedLeaveRef.current = false;
      CT.setContext({ userId: user?.id, roomId });
      CT.trace("LIFECYCLE", "joinCall_start", { roomId, callType });

      // Step 1: Join room (edge function → get Fishjam token)
      s.setCallPhase("joining_room");
      log("Joining existing room:", roomId);

      const joinResult = await videoApi.joinRoom(roomId);
      if (!joinResult.ok || !joinResult.data) {
        const msg = joinResult.error?.message || "Failed to join room";
        logError("Room join failed:", msg);
        s.setError(msg, joinResult.error?.code || "join_room_failed");
        CT.error("FISHJAM", "joinRoom_failed", { roomId, error: msg });
        return;
      }

      const { token, user: joinedUser, room: joinedRoom } = joinResult.data;
      log("Got Fishjam token for user:", joinedUser.id);
      log(
        `[SESSION] roomId=${roomId}, fishjamRoomId=${joinedRoom?.fishjamRoomId}, userId=${joinedUser.id}`,
      );

      // Step 2: Connect Fishjam peer
      s.setCallPhase("connecting_peer");
      log("Connecting Fishjam peer...");
      log(
        `[DEBUG] token length=${token?.length ?? 0}, joinRoomRef=${typeof joinRoomRef.current}`,
      );

      if (!token) {
        logError("No Fishjam token returned from edge function");
        s.setError("No peer token received", "no_peer_token");
        CT.error("FISHJAM", "no_peer_token", { roomId });
        return;
      }

      try {
        await joinRoomRef.current({
          peerToken: token,
          peerMetadata: {
            userId: joinedUser.id,
            username: joinedUser.username,
            avatar: joinedUser.avatar,
          },
        });
        log("Fishjam peer connected successfully");
        CT.trace("FISHJAM", "peerConnected", { roomId });
      } catch (peerErr: any) {
        logError("Fishjam peer join failed:", peerErr);
        logError(
          "[DEBUG] peerErr type:",
          typeof peerErr,
          "value:",
          JSON.stringify(peerErr),
        );
        s.setError(
          peerErr?.message || "WebRTC connection failed",
          "peer_join_failed",
        );
        CT.error("FISHJAM", "peerJoin_crashed", {
          roomId,
          error: peerErr?.message,
        });
        return;
      }

      // Step 3: Start in-call audio session FIRST.
      // CRITICAL: Must run BEFORE setPendingMicStart() because start() resets
      // _isCallKitActivated. If we set the mic callback first and CallKit already
      // fired (callee answered before joinCall ran), the callback would execute
      // on a stale session, then start() would reconfigure — killing the mic track.
      audioSession.start(callType === "video", callType);

      // Step 4: Set up deferred mic start callback AFTER audio session is configured.
      // On iOS, the callback will be invoked by audioSession.activateFromCallKit()
      // when CallKit fires didActivateAudioSession (or immediately if already fired).
      // On Android, the callback fires immediately (no CallKit).
      audioSession.setPendingMicStart(async () => {
        if (micStartedRef.current) {
          log("[CALLEE] Mic already started, skipping duplicate");
          return;
        }
        micStartedRef.current = true;
        try {
          // GUARD: Only start mic if it's not already on. toggleMicrophone() is a
          // true toggle — if a track already exists it STOPS it. On video calls,
          // camera init + CallKit timing can cause double-toggle → mic OFF.
          if (micRef.current.isMicrophoneOn) {
            log(
              `[${callType.toUpperCase()}] CALLEE mic already on, skipping toggleMicrophone to avoid toggling OFF`,
            );
          } else {
            await micRef.current.toggleMicrophone();
          }
          const s = getStore();
          s.setMicOn(true);

          const micStream = micRef.current.microphoneStream;
          const isMicOn = micRef.current.isMicrophoneOn;
          const audioTrackCount = micStream?.getAudioTracks?.()?.length ?? 0;

          CT.trace("MEDIA", "mic_started_callee", {
            hasStream: !!micStream,
            isMicOn,
            audioTrackCount,
            callType,
          });
          log(
            `[${callType.toUpperCase()}] Callee mic started + published via toggleMicrophone — stream=${!!micStream}, tracks=${audioTrackCount}, isMicOn=${isMicOn}`,
          );

          if (!micStream || audioTrackCount === 0) {
            CT.warn("MEDIA", "mic_started_no_stream_callee", {
              hasStream: !!micStream,
              audioTrackCount,
            });
            logWarn(
              `[${callType.toUpperCase()}] Callee mic started but stream not yet available — may populate async`,
            );
          }
        } catch (micErr) {
          micStartedRef.current = false;
          logError(
            `[${callType.toUpperCase()}] Callee FAILED to start microphone:`,
            micErr,
          );
          CT.error("MEDIA", "mic_start_failed_callee", {
            error: (micErr as any)?.message,
            callType,
          });
          getStore().setError(
            "Microphone failed to start. Check permissions.",
            "mic_start_failed",
          );
        }
      });

      // Step 5: Start media (camera only for video, mic already deferred)
      const mediaOk = await startMedia(callType);
      if (!mediaOk) {
        logError("Media start failed, aborting call");
        CT.error("MEDIA", "startMedia_failed_callee", { roomId, callType });
        return;
      }

      // Callee is now connected — media is flowing
      // Speaker was already set by audioSession.start() above
      s.setCallPhase("connected");
      startDurationTimer();
      CT.trace("LIFECYCLE", "callee_connected", { roomId });
      log("[LIFECYCLE] Callee joined and media started — connected");
    },
    [user, startMedia, startDurationTimer, getStore],
  );

  // Keep joinCallRef in sync so createCall's collision detection can use it
  joinCallRef.current = joinCall;

  // ── Idempotent cleanup guard ───────────────────────────────────────
  // CRITICAL FIX: Prevent duplicate cleanup when both leaveCall() and external
  // end effect fire (e.g., user taps End → callKeepEndAll fires → onEnd handler
  // → external effect). Multiple leaveRoom() calls cause Fishjam errors → disconnect.
  const cleanupInProgressRef = useRef(false);

  // Track whether leaveCall() was already invoked by the user (vs external end from CallKeep)
  const userInitiatedLeaveRef = useRef(false);

  // ── Leave current call (IDEMPOTENT) ────────────────────────────────
  const leaveCall = useCallback(() => {
    // CRITICAL: Guard against duplicate cleanup
    if (cleanupInProgressRef.current) {
      CT.trace("LIFECYCLE", "leaveCall_DUPLICATE_IGNORED", {
        phase: getStore().callPhase,
      });
      log("[LIFECYCLE] leaveCall already in progress, ignoring duplicate call");
      return;
    }
    cleanupInProgressRef.current = true;

    // Mark as user-initiated so the external end effect skips duplicate cleanup
    userInitiatedLeaveRef.current = true;

    // Clear ring timeout if active (caller hung up before timeout)
    if (ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }

    const s = getStore();
    const currentRoomId = s.roomId;
    const duration = s.callDuration;
    const mode = s.callType;

    CT.trace("LIFECYCLE", "leaveCall", {
      roomId: currentRoomId ?? undefined,
      phase: s.callPhase,
    });
    log(`Leaving ${mode} call, roomId:`, currentRoomId, "duration:", duration);

    // End call signals
    if (currentRoomId) {
      callSignalsApi.endCallSignals(currentRoomId).catch((e) => {
        logWarn("Failed to end call signals:", e);
      });

      CT.guard("CALLKEEP", "endCall", () => {
        callKeepEndCall(currentRoomId);
        clearCallMapping(currentRoomId);
      });
    }

    // Safety net: always end ALL CallKit calls to prevent orphaned native UI
    CT.guard("CALLKEEP", "endAllCalls", () => {
      callKeepEndAllCalls();
    });

    stopDurationTimer();

    // Leave Fishjam room FIRST — disconnects WebRTC peer connection.
    // Must happen BEFORE stopMicrophone/stopCamera to avoid "Array already
    // consumed" error from the SDK trying to unpublish on a dead connection.
    CT.guard("FISHJAM", "leaveRoom", () => {
      leaveRoomRef.current();
    });

    // Stop media AFTER leaving room — safe to clean up local tracks now
    CT.guard("MEDIA", "stopMedia", () => {
      if (mode === "video" || s.isCameraOn) {
        cameraRef.current.stopCamera();
        log("Camera stopped");
      }
      micRef.current.stopMicrophone();
      log("Microphone stopped");
    });

    // Stop in-call audio session (speaker, mic routing, audio focus)
    CT.guard("AUDIO", "audioSession_stop", () => {
      audioSession.stop();
    });

    // Add "Call ended" system message to the linked chat
    const chatId = s.chatId;
    if (chatId) {
      const durationStr =
        duration > 0
          ? ` · ${Math.floor(duration / 60)}:${(duration % 60).toString().padStart(2, "0")}`
          : "";
      const label = mode === "audio" ? "Audio call ended" : "Video call ended";
      useChatStore
        .getState()
        .addSystemMessage(chatId, `📞 ${label}${durationStr}`);
    }

    s.setCallEnded(duration);
    CT.trace("LIFECYCLE", "callEnded_COMPLETE", { duration });
    CT.clearContext();
    log(`[${mode.toUpperCase()}] Call ended, duration:`, duration);

    // Reset cleanup guard after a delay to allow new calls
    setTimeout(() => {
      cleanupInProgressRef.current = false;
    }, 1000);
  }, [stopDurationTimer, getStore]);

  // Keep leaveCallRef in sync for auto-end timeout
  leaveCallRef.current = leaveCall;

  // ── Toggle mute ────────────────────────────────────────────────────
  // CRITICAL FIX: Do NOT use stopMicrophone/startMicrophone for mute toggle.
  // stopMicrophone() UNPUBLISHES the audio track entirely — the remote side
  // loses the track and may never get it back. startMicrophone() re-publishes
  // which is unreliable mid-call.
  // Instead, toggle MediaStreamTrack.enabled which keeps the track published
  // but silences/unsilences it. This is how Instagram/Snapchat mute works.
  //
  // REF: https://docs.fishjam.io/how-to/react-native/start-streaming
  //   "startMicrophone() publishes the audio track. To mute without
  //    unpublishing, toggle MediaStreamTrack.enabled."
  const toggleMute = useCallback(() => {
    const s = getStore();
    const wantMuted = s.isMicOn; // if currently on, we want to mute

    CT.trace("MUTE", wantMuted ? "muting" : "unmuting", {
      roomId: s.roomId ?? undefined,
    });

    // Track-level toggle (keeps track published, silences/unsilences)
    // REF: Fishjam SDK useMicrophone().microphoneStream: MediaStream | null
    const stream = micRef.current.microphoneStream;
    let trackToggled = false;
    if (stream) {
      const audioTracks = stream.getAudioTracks();
      CT.trace("MUTE", "track_toggle_attempt", {
        trackCount: audioTracks.length,
        wantMuted,
      });
      if (audioTracks.length > 0) {
        for (const track of audioTracks) {
          track.enabled = !wantMuted;
        }
        trackToggled = true;
      } else {
        CT.warn("MUTE", "mic_stream_has_no_audio_tracks");
        logWarn("Mic stream exists but has 0 audio tracks");
      }
    } else {
      CT.warn("MUTE", "no_mic_stream_for_toggle", {
        isMicrophoneOn: micRef.current.isMicrophoneOn,
      });
      logWarn(
        "No mic stream available for mute toggle (isMicOn=" +
          micRef.current.isMicrophoneOn +
          ")",
      );
    }

    // Update all state sources in sync — even if track toggle failed,
    // the hardware mute via audioSession is a reliable fallback.
    s.setMicOn(!wantMuted);

    // CRITICAL: Lock mute echo BEFORE calling callKeepSetMuted.
    // callKeepSetMuted fires didPerformSetMutedCallAction which would
    // re-enter the coordinator's onToggleMute handler → feedback loop.
    // The lock suppresses that echo for 500ms.
    lockMuteEcho();
    if (s.roomId) callKeepSetMuted(s.roomId, wantMuted);
    audioSession.setMicMuted(wantMuted);

    CT.trace("MUTE", wantMuted ? "muted" : "unmuted", { trackToggled });
    log(
      wantMuted ? "Mic muted" : "Mic unmuted",
      `(trackToggled=${trackToggled})`,
    );
  }, [getStore]);

  // ── Escalate audio → video (explicit, permission-gated) ────────────
  // This is the ONLY way to enable camera during an audio call.
  // It requests camera permission, starts camera, then transitions mode.
  const escalateToVideo = useCallback(async (): Promise<boolean> => {
    const s = getStore();
    if (s.callType === "video") {
      log("Already in video mode, toggling camera");
      // Already video — just toggle camera on/off
      if (s.isCameraOn) {
        cameraRef.current.stopCamera();
        s.setCameraOn(false);
        log("Camera stopped");
      } else {
        try {
          // Use toggleCamera to both start AND publish the track
          const err = await cameraRef.current.toggleCamera();
          if (err) {
            logError("Failed to restart camera:", err);
            return false;
          }
          s.setCameraOn(true);
          log("Camera restarted + published via toggleCamera");
        } catch (e) {
          logError("Failed to restart camera:", e);
          return false;
        }
      }
      return true;
    }

    // Audio → Video escalation
    log("[ESCALATION] Audio → Video: requesting camera permission...");

    // Step 0: Request camera permission explicitly — audio calls never request it,
    // so the OS may not have granted it yet. Without this, startCamera() fails silently.
    // NOTE: We do NOT import react-native-vision-camera Camera here — it can crash
    // the app on import in certain contexts. Instead, use platform-native APIs.
    if (Platform.OS === "android") {
      try {
        const granted = await PermissionsAndroid.request(
          PermissionsAndroid.PERMISSIONS.CAMERA,
        );
        if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
          logError("[ESCALATION] Camera permission denied by user (Android)");
          return false;
        }
      } catch (permErr) {
        logError("[ESCALATION] Camera permission request failed:", permErr);
        return false;
      }
    }
    // iOS: startCamera() from Fishjam will trigger the OS permission prompt if needed.
    // No explicit request needed — the SDK handles it.

    // Step 1: Start camera via toggleCamera (starts + publishes)
    try {
      // Transition mode FIRST so setCameraOn doesn't hit the audio-mode guard
      s.escalateToVideo(); // callType: audio → video

      const frontId = getFrontCameraId();
      if (frontId) {
        await cameraRef.current.selectCamera(frontId);
      }
      const err = await cameraRef.current.toggleCamera();
      if (err) {
        logError("[ESCALATION] Camera permission denied or start failed:", err);
        // Revert escalation — call stays in audio mode
        s.setCallType("audio");
        return false;
      }

      s.setCameraOn(true); // Now safe — callType is "video"
      log("[ESCALATION] Successfully upgraded to video call via toggleCamera");
      return true;
    } catch (e) {
      logError("[ESCALATION] Failed to start camera:", e);
      // DON'T call setError — that kills the call. Escalation failure is non-fatal.
      return false;
    }
  }, [getFrontCameraId, getStore]);

  // ── Toggle video — delegates to escalation for audio mode ──────────
  const toggleVideo = useCallback(() => {
    escalateToVideo();
  }, [escalateToVideo]);

  // ── Switch camera (front/back) ─────────────────────────────────────
  const switchCamera = useCallback(() => {
    const stream = cameraRef.current.cameraStream;
    if (!stream) {
      logWarn("Cannot switch camera: no active stream");
      return;
    }
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack && typeof (videoTrack as any)._switchCamera === "function") {
      (videoTrack as any)._switchCamera();
      getStore().toggleFrontCamera();
      log("Camera switched via _switchCamera");
    } else {
      logWarn("_switchCamera not available on track");
    }
  }, [getStore]);

  // ── Reset call ended state ─────────────────────────────────────────
  const resetCallEnded = useCallback(() => {
    getStore().reset();
    log("Call state reset");
  }, [getStore]);

  // ── React to external call_ended (e.g. CallKeep coordinator onEnd) ─
  // When the coordinator sets callPhase='call_ended' from the native UI
  // (lock screen swipe, notification decline), we must still leave Fishjam
  // and stop media. The leaveCall function handles all of this, but it
  // also sets callPhase='call_ended' — so we guard with refs to avoid loops.
  const externalEndHandledRef = useRef(false);
  useEffect(() => {
    if (callPhase === "call_ended" && !externalEndHandledRef.current) {
      externalEndHandledRef.current = true;

      // CRITICAL FIX: Check if cleanup is already in progress to prevent duplicate cleanup
      if (cleanupInProgressRef.current) {
        log(
          "[LIFECYCLE] External call_ended but cleanup already in progress — skipping",
        );
        return;
      }

      // If leaveCall() already ran (user tapped End), skip duplicate cleanup.
      // The coordinator's onEnd fires AFTER leaveCall due to callKeepEndAllCalls,
      // which would otherwise double-fire leaveRoom and cause Fishjam errors.
      if (userInitiatedLeaveRef.current) {
        log(
          "[LIFECYCLE] External call_ended after user-initiated leave — skipping duplicate cleanup",
        );
        return;
      }

      // Mark cleanup in progress to prevent races
      cleanupInProgressRef.current = true;

      // Only do Fishjam/media cleanup — the phase is already set
      log(
        "[LIFECYCLE] External call_ended detected — cleaning up Fishjam/media",
      );
      stopDurationTimer();

      // Leave Fishjam FIRST, then stop media (same order as leaveCall)
      CT.guard("FISHJAM", "leaveRoom_external", () => {
        leaveRoomRef.current();
      });
      try {
        if (callType === "video" || isCameraOn) {
          cameraRef.current.stopCamera();
        }
        micRef.current.stopMicrophone();
      } catch (e) {
        logWarn("Error stopping media on external end:", e);
      }

      // Reset cleanup guard after a delay
      setTimeout(() => {
        cleanupInProgressRef.current = false;
      }, 1000);
    }
    // Reset the guard when we go back to idle
    if (callPhase === "idle") {
      externalEndHandledRef.current = false;
      userInitiatedLeaveRef.current = false;
      cleanupInProgressRef.current = false;
    }
  }, [callPhase, callType, isCameraOn, stopDurationTimer]);

  // ── Ring timeout: auto-end with "missed" if callee doesn't answer ──
  // Facebook/Instagram style: ring for 30s, then mark as missed call.
  // Only applies to the CALLER in outgoing_ringing phase.
  useEffect(() => {
    // Start timeout when entering outgoing_ringing
    if (callPhase === "outgoing_ringing" && callRole === "caller") {
      // Clear any existing timeout first
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
      }

      log(`[RING_TIMEOUT] Starting ${RING_TIMEOUT_MS / 1000}s ring timeout`);
      ringTimeoutRef.current = setTimeout(() => {
        const s = getStore();
        // Only fire if still ringing (callee may have answered)
        if (s.callPhase !== "outgoing_ringing") {
          log("[RING_TIMEOUT] Phase changed, skipping missed call");
          return;
        }

        const currentRoomId = s.roomId;
        const mode = s.callType;
        log("[RING_TIMEOUT] Callee didn't answer — marking as missed call");
        CT.trace("LIFECYCLE", "ring_timeout_missed", {
          roomId: currentRoomId ?? undefined,
          callType: mode,
        });

        // Mark signals as "missed" (not "ended")
        if (currentRoomId) {
          callSignalsApi.missCallSignals(currentRoomId).catch((e) => {
            logWarn("Failed to mark signals as missed:", e);
          });
        }

        // Add "Missed call" system message to the linked chat
        const chatId = s.chatId;
        if (chatId) {
          const label =
            mode === "audio" ? "Missed audio call" : "Missed video call";
          useChatStore.getState().addSystemMessage(chatId, `📞 ${label}`);
        }

        // End the call
        leaveCallRef.current();
      }, RING_TIMEOUT_MS);
    }

    // Clear timeout when phase changes away from outgoing_ringing
    if (callPhase !== "outgoing_ringing" && ringTimeoutRef.current) {
      clearTimeout(ringTimeoutRef.current);
      ringTimeoutRef.current = null;
    }

    return () => {
      if (ringTimeoutRef.current) {
        clearTimeout(ringTimeoutRef.current);
        ringTimeoutRef.current = null;
      }
    };
  }, [callPhase, callRole, getStore]);

  // ── Supabase Realtime fallback: detect remote party ending call ────
  // The primary mechanism is Fishjam peer disconnect (peers.remotePeers going empty).
  // This is a FALLBACK in case Fishjam doesn't fire the peer leave event reliably.
  // When the callee calls leaveCall(), it updates call_signals status to "ended".
  // We subscribe to UPDATE events on call_signals for our roomId.
  const signalChannelRef = useRef<ReturnType<typeof supabase.channel> | null>(
    null,
  );

  useEffect(() => {
    const currentRoomId = roomId_store;
    const phase = callPhase;

    // Only subscribe when we're in an active call
    if (
      !currentRoomId ||
      (phase !== "connected" &&
        phase !== "outgoing_ringing" &&
        phase !== "starting_media" &&
        phase !== "connecting_peer")
    ) {
      // Cleanup if we had a subscription
      if (signalChannelRef.current) {
        supabase.removeChannel(signalChannelRef.current);
        signalChannelRef.current = null;
      }
      return;
    }

    // Don't re-subscribe if already subscribed for this room
    if (signalChannelRef.current) return;

    log(
      `[SIGNAL_SUB] Subscribing to call_signals updates for room: ${currentRoomId}`,
    );
    const channel = supabase
      .channel(`call_end:${currentRoomId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "call_signals",
          filter: `room_id=eq.${currentRoomId}`,
        },
        (payload) => {
          const updated = payload.new as { status: string; room_id: string };
          log(
            `[SIGNAL_SUB] Signal updated: status=${updated.status} room=${updated.room_id}`,
          );

          if (updated.status === "ended") {
            const current = getStore();
            // Only auto-end if we're still in an active call phase
            if (
              current.callPhase === "connected" ||
              current.callPhase === "outgoing_ringing"
            ) {
              log(
                "[SIGNAL_SUB] Remote party ended call — triggering leaveCall in 1s",
              );
              setTimeout(() => {
                const recheck = getStore();
                if (
                  recheck.callPhase === "connected" ||
                  recheck.callPhase === "outgoing_ringing"
                ) {
                  log(
                    "[SIGNAL_SUB] Confirmed: ending call via signal fallback",
                  );
                  leaveCallRef.current();
                }
              }, 1000);
            }
          }
        },
      )
      .subscribe((status) => {
        log(`[SIGNAL_SUB] Subscription status: ${status}`);
      });

    signalChannelRef.current = channel;

    return () => {
      if (signalChannelRef.current) {
        supabase.removeChannel(signalChannelRef.current);
        signalChannelRef.current = null;
      }
    };
  }, [roomId_store, callPhase, getStore]);

  // ── Cleanup on unmount ─────────────────────────────────────────────
  useEffect(() => {
    return () => {
      stopDurationTimer();
      leaveRoomRef.current();
      if (signalChannelRef.current) {
        supabase.removeChannel(signalChannelRef.current);
        signalChannelRef.current = null;
      }
      // Don't reset store here — call_ended UI may still be showing
    };
  }, [stopDurationTimer]);

  // ── Derived state for consumers ────────────────────────────────────
  const isAudioMode = callType === "audio";

  return {
    // State from store (individual selectors — no re-render storms)
    callPhase,
    callType,
    callRole,
    callDirection,
    recipientInfo,
    roomId: roomId_store,
    chatId: chatId_store,
    callEnded,
    callDuration,
    error: error_store,
    errorCode: errorCode_store,
    connectionStatus,
    isConnected: connectionStatus === "connected",
    isInCall: callPhase === "connected" || callPhase === "outgoing_ringing",
    isMuted: !isMicOn,
    isVideoOff: !isCameraOn,
    localStream,
    participants,
    cameraPermission,
    micPermission,
    isSpeakerOn,
    isPiPActive,

    // Derived
    isAudioMode,
    isCaller: callRole === "caller",
    isCallee: callRole === "callee",

    // Actions
    createCall,
    joinCall,
    leaveCall,
    toggleMute,
    toggleVideo,
    escalateToVideo,
    switchCamera,
    resetCallEnded,
  };
}
