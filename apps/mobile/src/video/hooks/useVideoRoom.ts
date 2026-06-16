/**
 * useVideoRoom Hook
 * Main hook for managing video room state with Fishjam
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  RENDER-STABILITY GUARDRAIL — READ BEFORE EDITING                  ║
 * ║                                                                    ║
 * ║  All room state lives in useVideoRoomStore (Zustand).              ║
 * ║  This hook orchestrates Fishjam SDK ↔ store sync.                  ║
 * ║                                                                    ║
 * ║  1. NO useCallback may list store state or prop callbacks in deps. ║
 * ║     Read them from store.getState() / refs instead.                ║
 * ║                                                                    ║
 * ║  2. NO useEffect may depend on store state or derived callbacks.   ║
 * ║     Use [] for one-time subscriptions; use primitive Fishjam       ║
 * ║     values (peerStatus, reconnectionStatus) only where needed.     ║
 * ║                                                                    ║
 * ║  3. Fishjam SDK refs (joinRoom, leaveRoom) are ref-wrapped        ║
 * ║     because their identity is NOT guaranteed stable across         ║
 * ║     reconnects.                                                    ║
 * ║                                                                    ║
 * ║  ORIGINAL BUG: connectionState effect → setState (new obj) →      ║
 * ║  handleRoomEvent recreated (dep on state.localUser) →             ║
 * ║  scheduleTokenRefresh recreated → join recreated → screen         ║
 * ║  re-renders → effects re-fire → infinite loop.                    ║
 * ║                                                                    ║
 * ║  FIX: Zustand store + getState() eliminates all dependency cycles. ║
 * ║  Store updates are granular — only subscribed slices re-render.    ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { useCallback, useEffect, useRef } from "react";
import {
  useConnection,
  useCamera,
  useMicrophone,
  usePeers,
  useScreenShare,
} from "@fishjam-cloud/react-native-client";
import { AppState, type AppStateStatus } from "react-native";
import { videoApi } from "../api";
import { useVideoRoomStore } from "../stores/video-room-store";
import { audioSession } from "@/src/services/calls/audioSession";
import type {
  ConnectionState,
  Participant,
  EjectPayload,
  MemberRole,
  RoomEvent,
} from "../types";

const TOKEN_REFRESH_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 min before expiry

interface UseVideoRoomOptions {
  roomId: string;
  anonymous?: boolean;
  onEjected?: (reason: EjectPayload) => void;
  onRoomEnded?: () => void;
  /**
   * Fired on join/reconnect failure. The second arg carries the full
   * error envelope (code + structured detail) for consumers that want
   * to render rich UX like the capacity flow. `message` is kept as
   * the first arg for backwards-compat with older call sites.
   */
  onError?: (
    message: string,
    envelope?: {
      code?: string;
      detail?: Record<string, unknown>;
    },
  ) => void;
}

function resolvePeerTracks(peer: any) {
  const videoTrack =
    peer.cameraTrack ??
    peer.videoTrack ??
    peer.tracks?.find((track: any) => track.metadata?.type === "camera") ??
    null;
  const audioTrack =
    peer.microphoneTrack ??
    peer.audioTrack ??
    peer.tracks?.find((track: any) => track.metadata?.type === "microphone") ??
    null;

  return { videoTrack, audioTrack };
}

function isTrackActive(track: any): boolean {
  if (!track) return false;

  const mediaTrack = track.track ?? null;
  if (mediaTrack) {
    if (mediaTrack.readyState === "ended") return false;
    if (typeof mediaTrack.enabled === "boolean" && !mediaTrack.enabled) {
      return false;
    }
    return true;
  }

  const stream = track.stream ?? null;
  if (stream && typeof stream.getTracks === "function") {
    const liveTracks = stream
      .getTracks()
      .filter((item: MediaStreamTrack | null | undefined) => {
        return item && item.readyState !== "ended";
      });

    if (liveTracks.length > 0) {
      return liveTracks.some((item: MediaStreamTrack) => item.enabled !== false);
    }

    if (typeof stream.active === "boolean") {
      return stream.active;
    }
  }

  return !!(track.trackId || stream);
}

function getPeerIdentity(peer: any): string {
  const metadata = (peer.metadata as Record<string, unknown>) || {};
  const userId = metadata.userId;

  return typeof userId === "string" && userId.length > 0 ? userId : peer.id;
}

function getPeerScore(peer: any): number {
  const { videoTrack, audioTrack } = resolvePeerTracks(peer);

  return (
    (isTrackActive(videoTrack) ? 4 : videoTrack ? 1 : 0) +
    (isTrackActive(audioTrack) ? 4 : audioTrack ? 1 : 0) +
    (peer.screenShareVideoTrack ? 1 : 0)
  );
}

export function useVideoRoom({
  roomId,
  anonymous = false,
  onEjected,
  onRoomEnded,
  onError,
}: UseVideoRoomOptions) {
  const { joinRoom, leaveRoom, peerStatus, reconnectionStatus } =
    useConnection();
  const cameraHook = useCamera();
  const microphoneHook = useMicrophone();
  const screenShareHook = useScreenShare();
  const peersHook = usePeers();

  // ── Store access ──────────────────────────────────────────────────
  // Subscribe to full state for return value; use getState() in callbacks.
  const store = useVideoRoomStore();
  const getStore = useVideoRoomStore.getState;

  // ── Internal refs (timers, subscriptions) ───────────────────────────
  const tokenExpiresAtRef = useRef<Date | null>(null);
  const tokenRefreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const currentJtiRef = useRef<string | null>(null);
  const unsubscribeEventsRef = useRef<(() => void) | null>(null);
  const unsubscribeMembersRef = useRef<(() => void) | null>(null);
  const cameraToggleInFlightRef = useRef(false);
  const cameraSwitchInFlightRef = useRef(false);
  const micToggleInFlightRef = useRef(false);

  // ── Ref-wrapped external callbacks & SDK refs ───────────────────────
  // Prevents dependency cycles — callbacks read from refs, not deps.

  // Prevents: handleEject depending on onEjected prop
  const onEjectedRef = useRef(onEjected);
  onEjectedRef.current = onEjected;

  // Prevents: handleRoomEnded depending on onRoomEnded prop
  const onRoomEndedRef = useRef(onRoomEnded);
  onRoomEndedRef.current = onRoomEnded;

  // Prevents: join/kick/ban/endRoom depending on onError prop
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  // Prevents: join depending on anonymous prop identity
  const anonymousRef = useRef(anonymous);
  anonymousRef.current = anonymous;

  // Prevents: callbacks depending on Fishjam SDK refs whose identity
  // may change across reconnects
  const joinRoomRef = useRef(joinRoom);
  joinRoomRef.current = joinRoom;
  const leaveRoomRef = useRef(leaveRoom);
  leaveRoomRef.current = leaveRoom;

  // Prevents: toggleCamera/toggleMic depending on cameraHook/microphoneHook
  const cameraRef = useRef(cameraHook);
  cameraRef.current = cameraHook;
  const microphoneRef = useRef(microphoneHook);
  microphoneRef.current = microphoneHook;

  useEffect(() => {
    // Fishjam is the source of truth for local camera state. Mirror it into the
    // room store so the Sneaky Lynk controls don't drift after failed toggles
    // or async track publication.
    const camera = cameraRef.current;
    getStore().setCameraOn(!!camera.isCameraOn);
  }, [cameraHook.isCameraOn, cameraHook.cameraStream, getStore]);

  useEffect(() => {
    const microphone = microphoneRef.current;
    getStore().setMicOn(!!microphone.isMicrophoneOn);
  }, [
    microphoneHook.isMicrophoneOn,
    microphoneHook.microphoneStream,
    getStore,
  ]);

  useEffect(() => {
    const currentCamera = cameraHook.currentCamera;
    if (!currentCamera) return;

    const deviceLabel = `${currentCamera.label || ""}`.toLowerCase();
    if (deviceLabel.includes("back") || deviceLabel.includes("rear")) {
      getStore().setFrontCamera(false);
      return;
    }

    if (deviceLabel.includes("front")) {
      getStore().setFrontCamera(true);
    }
  }, [cameraHook.currentCamera, getStore]);

  // ── Connection state sync ───────────────────────────────────────────
  // Deps: only primitive Fishjam status values. Store bails out if unchanged.
  useEffect(() => {
    let newStatus: ConnectionState["status"] = "disconnected";

    if (peerStatus === "connected") {
      newStatus = "connected";
    } else if (peerStatus === "connecting") {
      newStatus = "connecting";
    } else if (reconnectionStatus === "reconnecting") {
      newStatus = "reconnecting";
    } else if (peerStatus === "error") {
      newStatus = "error";
    }

    getStore().setConnectionStatus(newStatus);
  }, [peerStatus, reconnectionStatus, getStore]);

  // ── Stable callbacks (deps: [] only) ────────────────────────────────
  // All mutable values read from store.getState() or refs.

  const clearTokenTimer = useCallback(() => {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current);
      tokenRefreshTimerRef.current = null;
    }
  }, []);

  const getPreferredCameraId = useCallback((facing: "front" | "back") => {
    const devices = cameraRef.current.cameraDevices || [];
    // Accept BOTH human-label values ("front"/"back") AND the WebRTC
    // spec values that react-native-webrtc exposes on facingMode:
    //   front  ↔  "user"
    //   back   ↔  "environment"
    // Older devices expose `position`, newer builds expose `facingMode`;
    // some Android builds only populate the `label`. We check all of
    // them so the matcher works on every platform Fishjam runs on.
    const needles =
      facing === "front"
        ? ["front", "user", "facingmodeuser"]
        : ["back", "environment", "facingmodeenvironment", "rear"];

    const match = devices.find((device: any) => {
      const label = String(device?.label || "").toLowerCase();
      const deviceId = String(device?.deviceId || "").toLowerCase();
      const position = String(device?.position || "").toLowerCase();
      const facingMode = String(device?.facingMode || "").toLowerCase();
      return needles.some(
        (n) =>
          label.includes(n) ||
          deviceId.includes(n) ||
          position.includes(n) ||
          facingMode.includes(n),
      );
    });

    return match?.deviceId;
  }, []);

  const handleEject = useCallback(
    (payload: EjectPayload) => {
      getStore().setEjected(payload);
      leaveRoomRef.current();
      clearTokenTimer();
      onEjectedRef.current?.(payload);
    },
    [clearTokenTimer, getStore],
  );

  const handleRoomEnded = useCallback(() => {
    getStore().setRoomEnded();
    leaveRoomRef.current();
    clearTokenTimer();
    onRoomEndedRef.current?.();
  }, [clearTokenTimer, getStore]);

  const setMicEnabled = useCallback(
    async (enabled: boolean) => {
      try {
        const mic = microphoneRef.current;

        if (enabled) {
          if (!mic.isMicrophoneOn) {
            const toggleError = await mic.toggleMicrophone();
            if (toggleError) {
              console.error(
                "[useVideoRoom] Failed to start microphone:",
                toggleError,
              );
              onErrorRef.current?.("Failed to start microphone");
              getStore().setMicOn(false);
              audioSession.setMicMuted(true);
              return;
            }
          }

          getStore().setMicOn(true);
          audioSession.setMicMuted(false);
          return;
        }

        if (mic.isMicrophoneOn) {
          const toggleError = await mic.toggleMicrophone();
          if (toggleError) {
            console.error(
              "[useVideoRoom] Failed to stop microphone:",
              toggleError,
            );
            onErrorRef.current?.("Failed to toggle microphone");
            return;
          }
        }

        getStore().setMicOn(false);
        audioSession.setMicMuted(true);
      } catch (error) {
        console.error("[useVideoRoom] Failed to set microphone state:", error);
        onErrorRef.current?.("Failed to toggle microphone");
      }
    },
    [getStore],
  );

  const setCameraEnabled = useCallback(
    async (enabled: boolean) => {
      try {
        const camera = cameraRef.current;

        if (enabled) {
          if (!camera.isCameraOn) {
            const toggleError = await camera.toggleCamera();
            if (toggleError) {
              console.error("[useVideoRoom] Failed to start camera:", toggleError);
              onErrorRef.current?.("Failed to start camera");
              getStore().setCameraOn(false);
              return;
            }
          }

          getStore().setCameraOn(true);
          return;
        }

        if (camera.isCameraOn) {
          const toggleError = await camera.toggleCamera();
          if (toggleError) {
            console.error("[useVideoRoom] Failed to stop camera:", toggleError);
            onErrorRef.current?.("Failed to toggle camera");
            return;
          }
        }

        getStore().setCameraOn(false);
      } catch (error) {
        console.error("[useVideoRoom] Failed to set camera state:", error);
        onErrorRef.current?.("Failed to toggle camera");
      }
    },
    [getStore],
  );

  const handleRoomEvent = useCallback(
    (event: RoomEvent) => {
      console.log("[useVideoRoom] Event received:", event.type, event.payload);

      switch (event.type) {
        case "eject":
          if (event.targetId === getStore().localUser?.id) {
            const payload = event.payload as unknown as EjectPayload;
            handleEject(payload);
          }
          break;
        case "room_ended":
          handleRoomEnded();
          break;
        case "mute_peer":
          // Host requested we mute — turn off mic if it's on
          if (event.targetId === getStore().localUser?.id) {
            console.log("[useVideoRoom] Muted by host");
            void setMicEnabled(false);
          }
          break;
        case "mute_all": {
          // Host muted everyone — mute unless we ARE the host
          const localRole = getStore().localUser?.role;
          if (localRole !== "host") {
            console.log("[useVideoRoom] Muted by host (mute all)");
            void setMicEnabled(false);
          }
          break;
        }
        case "unmute_all": {
          // Host unmuted everyone — re-enable mic unless we ARE the host
          const localRole2 = getStore().localUser?.role;
          if (localRole2 !== "host") {
            console.log("[useVideoRoom] Unmuted by host (unmute all)");
            void setMicEnabled(true);
          }
          break;
        }
        case "unmute_peer":
          // Host is allowing us to unmute — turn mic back on
          if (event.targetId === getStore().localUser?.id) {
            console.log("[useVideoRoom] Unmuted by host");
            void setMicEnabled(true);
          }
          break;
        case "role_changed":
          // Our role was changed by the host
          if (event.targetId === getStore().localUser?.id) {
            const newRole = (event.payload as any)?.newRole;
            console.log("[useVideoRoom] Role changed to:", newRole);
            const current = getStore().localUser;
            if (current && newRole) {
              getStore().setLocalUser({ ...current, role: newRole });
            }
          }
          break;
      }
    },
    [handleEject, handleRoomEnded, getStore, setMicEnabled],
  );

  const scheduleTokenRefresh = useCallback(
    (expiresAt: Date) => {
      clearTokenTimer();

      const now = Date.now();
      const refreshAt = expiresAt.getTime() - TOKEN_REFRESH_BUFFER_MS;
      const delay = Math.max(0, refreshAt - now);

      console.log(`[useVideoRoom] Token refresh scheduled in ${delay / 1000}s`);

      tokenRefreshTimerRef.current = setTimeout(async () => {
        try {
          console.log("[useVideoRoom] Refreshing token...");
          const result = await videoApi.refreshToken(
            roomId,
            currentJtiRef.current || undefined,
          );

          if (!result.ok) {
            console.error("[useVideoRoom] Token refresh failed:", result.error);
            if (result.error?.code === "forbidden") {
              handleEject({ action: "kick", reason: "Session expired" });
            }
            return;
          }

          // Reconnect with new token — read localUser from store
          const { localUser } = getStore();
          leaveRoomRef.current();
          await joinRoomRef.current({
            peerToken: result.data!.token,
            peerMetadata: {
              userId: localUser?.id,
              username: localUser?.username,
              displayName: localUser?.displayName,
              avatar: localUser?.avatar,
              role: localUser?.role,
              isAnonymous: localUser?.isAnonymous || false,
              anonLabel: localUser?.anonLabel || null,
            },
          });

          tokenExpiresAtRef.current = new Date(result.data!.expiresAt);
          scheduleTokenRefresh(tokenExpiresAtRef.current);
        } catch (err) {
          console.error("[useVideoRoom] Token refresh error:", err);
          onErrorRef.current?.("Failed to refresh session");
        }
      }, delay);
    },
    [roomId, clearTokenTimer, handleEject, getStore],
  );

  const join = useCallback(async () => {
    if (getStore().isEjected) {
      onErrorRef.current?.("You have been removed from this room");
      return false;
    }

    getStore().setConnectionStatus("connecting");

    try {
      const result = await videoApi.joinRoom(roomId, anonymousRef.current);

      if (!result.ok) {
        getStore().setConnectionStatus("error", result.error?.message);
        onErrorRef.current?.(
          result.error?.message || "Failed to join room",
          {
            code: result.error?.code,
            detail: result.error?.detail,
          },
        );
        return false;
      }

      const { room, token, peer, user, expiresAt } = result.data!;

      tokenExpiresAtRef.current = new Date(expiresAt);
      currentJtiRef.current = peer.id;

      // Update store with room + localUser
      const s = getStore();
      s.setRoom({
        id: room.id,
        title: room.title,
        sweetSpicyMode: room.sweetSpicyMode || "sweet",
        isPublic: false,
        status: "open",
        maxParticipants: 10,
        fishjamRoomId: room.fishjamRoomId,
        createdBy: "",
        createdAt: "",
      });
      s.setLocalUser({
        id: user.id,
        username: user.username,
        displayName: user.displayName || user.username,
        avatar: user.avatar,
        role: peer.role as MemberRole,
        peerId: peer.id,
        isAnonymous: user.isAnonymous || false,
        anonLabel: user.anonLabel || null,
      });

      // Connect to Fishjam — use ref for stable identity
      await joinRoomRef.current({
        peerToken: token,
        peerMetadata: {
          userId: user.id,
          username: user.username,
          displayName: user.displayName || user.username,
          avatar: user.avatar,
          role: peer.role,
          isAnonymous: user.isAnonymous || false,
          anonLabel: user.anonLabel || null,
        },
      });

      // Schedule token refresh
      scheduleTokenRefresh(tokenExpiresAtRef.current);

      // Subscribe to room events
      unsubscribeEventsRef.current = videoApi.subscribeToRoomEvents(
        roomId,
        user.id,
        handleRoomEvent,
      );

      // Subscribe to member changes
      unsubscribeMembersRef.current = videoApi.subscribeToMembers(
        roomId,
        (member, eventType) => {
          console.log(
            "[useVideoRoom] Member change:",
            eventType,
            member.userId,
          );
        },
      );

      return true;
    } catch (err) {
      console.error("[useVideoRoom] Join error:", err);
      getStore().setConnectionStatus("error", "Connection failed");
      onErrorRef.current?.("Failed to connect to room");
      return false;
    }
  }, [roomId, scheduleTokenRefresh, handleRoomEvent, getStore]);

  const leave = useCallback(async () => {
    console.log("[useVideoRoom] Leaving room...");

    clearTokenTimer();
    unsubscribeEventsRef.current?.();
    unsubscribeMembersRef.current?.();
    leaveRoomRef.current();

    const s = getStore();
    s.setConnectionStatus("disconnected");
    s.setParticipants([]);
  }, [clearTokenTimer, getStore]);

  // ── Media toggles ──────────────────────────────────────────────────
  // Read current on/off from store.getState(); read SDK hooks from refs.
  // Zero deps on state → stable identity.

  const toggleCamera = useCallback(async () => {
    if (cameraToggleInFlightRef.current) return;
    cameraToggleInFlightRef.current = true;

    try {
      await setCameraEnabled(!cameraRef.current.isCameraOn);
    } finally {
      cameraToggleInFlightRef.current = false;
    }
  }, [setCameraEnabled]);

  const toggleMic = useCallback(async () => {
    if (micToggleInFlightRef.current) return;
    micToggleInFlightRef.current = true;
    const wantEnabled = !getStore().isMicOn;
    try {
      await setMicEnabled(wantEnabled);
    } finally {
      micToggleInFlightRef.current = false;
    }
  }, [getStore, setMicEnabled]);

  const switchCamera = useCallback(async () => {
    if (cameraSwitchInFlightRef.current || cameraToggleInFlightRef.current) {
      return;
    }
    cameraSwitchInFlightRef.current = true;
    try {
      const currentCameraId = cameraRef.current.currentCamera?.deviceId;
      const nextFacing = getStore().isFrontCamera ? "back" : "front";
      const targetCameraId = getPreferredCameraId(nextFacing);

      // NOTE: we intentionally do NOT use `track._switchCamera()` here.
      // It's marked `@deprecated` in
      // @fishjam-cloud/react-native-webrtc/src/MediaStreamTrack.ts:118
      // and — the root-cause of the "flip camera doesn't work for the
      // host" bug — it reads `_settings.facingMode` to decide direction.
      // Fishjam starts cameras by deviceId, which leaves
      // `_settings.facingMode` undefined, so the toggle silently
      // resolves to `'user'` every time and no-ops on a device that
      // was already front-facing. Always use the supported
      // `selectCamera(deviceId)` path instead — it internally calls
      // `tsClient.replaceTrack` so remote peers see the new camera
      // immediately.

      if (targetCameraId && targetCameraId !== currentCameraId) {
        const selectError = await cameraRef.current.selectCamera(targetCameraId);
        if (!selectError) {
          getStore().setFrontCamera(nextFacing === "front");
          return;
        }
        console.warn(
          "[useVideoRoom] selectCamera failed:",
          selectError,
        );
      }

      console.warn("[useVideoRoom] No camera-switch path available", {
        nextFacing,
        targetCameraId,
        currentCameraId,
        devices: cameraRef.current.cameraDevices?.length ?? 0,
      });
      onErrorRef.current?.("Couldn't reverse camera");
    } catch (error) {
      console.error("[useVideoRoom] switchCamera failed:", error);
      onErrorRef.current?.("Couldn't reverse camera");
    } finally {
      cameraSwitchInFlightRef.current = false;
    }
  }, [getPreferredCameraId, getStore]);

  // ── Admin actions ──────────────────────────────────────────────────
  // Only depend on roomId (static for hook lifetime).

  const kickUser = useCallback(
    async (targetUserId: string, reason?: string) => {
      const result = await videoApi.kickUser({ roomId, targetUserId, reason });
      if (!result.ok) {
        onErrorRef.current?.(result.error?.message || "Failed to kick user");
      }
      return result.ok;
    },
    [roomId],
  );

  const banUser = useCallback(
    async (targetUserId: string, reason?: string, durationMinutes?: number) => {
      const result = await videoApi.banUser({
        roomId,
        targetUserId,
        reason,
        durationMinutes,
      });
      if (!result.ok) {
        onErrorRef.current?.(result.error?.message || "Failed to ban user");
      }
      return result.ok;
    },
    [roomId],
  );

  const endRoom = useCallback(async () => {
    const result = await videoApi.endRoom(roomId);
    if (!result.ok) {
      onErrorRef.current?.(result.error?.message || "Failed to end room");
    }
    return result.ok;
  }, [roomId]);

  // ── Participants sync ──────────────────────────────────────────────
  // REF: Fishjam SDK v0.25 PeerWithTracks exposes distinguished tracks:
  //   peer.cameraTrack, peer.microphoneTrack (Track | undefined)
  // REF: https://docs.fishjam.io/tutorials/react-native-quick-start
  useEffect(() => {
    // Use remotePeers (peers is deprecated in v0.25)
    const allPeers = peersHook.remotePeers || peersHook.peers || [];
    const peersByUserId = new Map<string, any>();

    allPeers.forEach((peer: any) => {
      const identity = getPeerIdentity(peer);
      const existingPeer = peersByUserId.get(identity);

      if (!existingPeer || getPeerScore(peer) >= getPeerScore(existingPeer)) {
        peersByUserId.set(identity, peer);
      }
    });

    const participants: Participant[] = Array.from(peersByUserId.values()).map(
      (peer: any) => {
      const metadata = (peer.metadata as Record<string, unknown>) || {};
      const { videoTrack, audioTrack } = resolvePeerTracks(peer);

      return {
        odId: peer.id,
        oderId: peer.id,
        userId: getPeerIdentity(peer),
        username: metadata.username as string | undefined,
        displayName:
          (metadata.displayName as string | undefined) ||
          (metadata.username as string | undefined),
        avatar: metadata.avatar as string | undefined,
        role: (metadata.role as MemberRole) || "participant",
        isLocal: false,
        isCameraOn: isTrackActive(videoTrack),
        isMicOn: isTrackActive(audioTrack),
        isScreenSharing: !!peer.screenShareVideoTrack,
        videoTrack,
        audioTrack,
        isAnonymous: (metadata.isAnonymous as boolean) || false,
        anonLabel: (metadata.anonLabel as string) || null,
      };
    });

    getStore().setParticipants(participants);
  }, [peersHook.remotePeers, peersHook.peers, getStore]);

  // ── App state listener ─────────────────────────────────────────────
  // One-time subscription. Reads connection status from store.
  useEffect(() => {
    const handleAppStateChange = (nextAppState: AppStateStatus) => {
      if (
        nextAppState === "active" &&
        getStore().connectionState.status === "connected"
      ) {
        console.log("[useVideoRoom] App became active, checking connection...");
      } else if (nextAppState === "background") {
        console.log("[useVideoRoom] App went to background");
      }
    };

    const subscription = AppState.addEventListener(
      "change",
      handleAppStateChange,
    );
    return () => subscription.remove();
  }, [getStore]);

  // ── Cleanup on unmount ─────────────────────────────────────────────
  // Only run full cleanup (leaveRoom, reset) if we have a roomId.
  // For non-server rooms (empty roomId), this hook is a no-op and must
  // NOT call leaveRoom — that would kill the shared Fishjam camera/mic.
  const roomIdRef = useRef(roomId);
  roomIdRef.current = roomId;
  useEffect(() => {
    return () => {
      if (!roomIdRef.current) return;
      clearTokenTimer();
      unsubscribeEventsRef.current?.();
      unsubscribeMembersRef.current?.();
      leaveRoomRef.current();
      getStore().reset();
    };
  }, [clearTokenTimer, getStore]);

  // ── Public API ─────────────────────────────────────────────────────
  // Spread store state so consumers get reactive updates via Zustand.
  return {
    room: store.room,
    localUser: store.localUser,
    participants: store.participants,
    connectionState: store.connectionState,
    isCameraOn: store.isCameraOn,
    isMicOn: store.isMicOn,
    isFrontCamera: store.isFrontCamera,
    isEjected: store.isEjected,
    ejectReason: store.ejectReason,
    join,
    leave,
    toggleCamera,
    toggleMic,
    setCameraEnabled,
    setMicEnabled,
    switchCamera,
    kickUser,
    banUser,
    endRoom,
    camera: cameraHook,
    microphone: microphoneHook,
    screenShare: screenShareHook,
  };
}
