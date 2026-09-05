/**
 * useVideoRoom Hook
 * Main hook for managing video room state.
 *
 * WS-3b: the media transport is MoQ (`useLynkBroadcast` → `react-native-moq`),
 * not Fishjam. Everything ELSE — join/leave, roles, ejection, host mute, token
 * refresh, room events — is Supabase and is unchanged; only the media seam moved.
 * Speakers publish and listeners subscribe through the SAME hook, gated by
 * `canPublish`, because hooks cannot be called conditionally.
 *
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  RENDER-STABILITY GUARDRAIL — READ BEFORE EDITING                  ║
 * ║                                                                    ║
 * ║  All room state lives in useVideoRoomStore (Zustand).              ║
 * ║  This hook orchestrates transport ↔ store sync.                    ║
 * ║                                                                    ║
 * ║  1. NO useCallback may list store state or prop callbacks in deps. ║
 * ║     Read them from store.getState() / refs instead.                ║
 * ║                                                                    ║
 * ║  2. NO useEffect may depend on store state or derived callbacks.   ║
 * ║     Use [] for one-time subscriptions; use primitive transport     ║
 * ║     values (media.state) only where needed.                        ║
 * ║                                                                    ║
 * ║  3. Transport callbacks (end, setCameraEnabled…) are ref-wrapped  ║
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

import { useCallback, useEffect, useRef, useState } from "react";
import { useLynkBroadcast } from "@dvnt/app/lib/lynk/useLynkBroadcast.native";
import { isPublisherRole } from "@dvnt/app/features/sneaky-lynk/publish-roles";
import { AppState, type AppStateStatus } from "react-native";
import { videoApi } from "../api";
import { useVideoRoomStore } from "../stores/video-room-store";
import {
  applyHostMuteEvent,
  canSelfUnmute,
  shouldStopMic,
} from "@dvnt/app/lib/video/host-mute";
import { audioSession } from "@dvnt/app/features/services/calls/audioSession";
import { mergeParticipants } from "../lynk-participants";
import type {
  ConnectionState,
  EjectPayload,
  MemberRole,
  RoomEvent,
  RoomMember,
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

export function useVideoRoom({
  roomId,
  anonymous = false,
  onEjected,
  onRoomEnded,
  onError,
}: UseVideoRoomOptions) {
  // ── Store access ──────────────────────────────────────────────────
  // Subscribe to full state for return value; use getState() in callbacks.
  const store = useVideoRoomStore();
  const getStore = useVideoRoomStore.getState;

  // ── Media transport (MoQ) ─────────────────────────────────────────
  // Role decides publish capability, and it only exists after video_join_room
  // resolves — before that `canPublish` is false, so no publish token is
  // requested and `lynk-moq-token` is never asked to deny one. When the role
  // lands the hook mints, connects and goes live on its own.
  const localRole = store.localUser?.role;
  // Shared with the web room AND with `lynk-moq-token`. This list used to be
  // spelled out here and disagreed with the server: `participant` — the role
  // every joiner gets — was missing, so a guest never asked for a publish
  // token and the host was hosting people who could see and hear but could
  // never be seen or heard.
  const canPublish = isPublisherRole(localRole);
  const media = useLynkBroadcast(roomId || undefined, canPublish);

  // The roster carries identity for remote tiles (MoQ paths carry none).
  const [members, setMembers] = useState<RoomMember[]>([]);

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

  // Prevents: callbacks depending on transport identities, which change
  // across reconnects (token refresh rebuilds the session).
  const mediaRef = useRef(media);
  mediaRef.current = media;

  // The transport owns local capture state; mirror it into the store so the
  // Sneaky Lynk controls can't drift from what is actually being published.
  // Gated on `canPublish`, not on `isLive`: capture is what the mic/camera
  // buttons reflect, and a listener has none. Keying it on isLive instead
  // would report a speaker's camera as off during the go-live handshake.
  useEffect(() => {
    getStore().setCameraOn(media.cameraEnabled && canPublish);
  }, [media.cameraEnabled, canPublish, getStore]);

  useEffect(() => {
    getStore().setMicOn(media.micEnabled && canPublish);
  }, [media.micEnabled, canPublish, getStore]);

  useEffect(() => {
    getStore().setFrontCamera(media.cameraTrack.position !== "back");
  }, [media.cameraTrack.position, getStore]);

  // ── Connection state sync ───────────────────────────────────────────
  // Deps: one primitive transport state. Store bails out if unchanged.
  useEffect(() => {
    const byState: Record<string, ConnectionState["status"]> = {
      idle: "disconnected",
      "requesting-token": "connecting",
      connecting: "connecting",
      live: "connected",
      reconnecting: "reconnecting",
      ended: "disconnected",
      error: "error",
    };
    getStore().setConnectionStatus(byState[media.state] ?? "disconnected");
  }, [media.state, getStore]);

  // ── Stable callbacks (deps: [] only) ────────────────────────────────
  // All mutable values read from store.getState() or refs.

  const clearTokenTimer = useCallback(() => {
    if (tokenRefreshTimerRef.current) {
      clearTimeout(tokenRefreshTimerRef.current);
      tokenRefreshTimerRef.current = null;
    }
  }, []);

  const handleEject = useCallback(
    (payload: EjectPayload) => {
      getStore().setEjected(payload);
      mediaRef.current.end();
      clearTokenTimer();
      onEjectedRef.current?.(payload);
    },
    [clearTokenTimer, getStore],
  );

  const handleRoomEnded = useCallback(() => {
    getStore().setRoomEnded();
    mediaRef.current.end();
    clearTokenTimer();
    onRoomEndedRef.current?.();
  }, [clearTokenTimer, getStore]);

  const setMicEnabled = useCallback(
    async (enabled: boolean) => {
      // The choke point for every path that can start publishing — toggleMic,
      // the room screens' own handlers, and the post-reconnect media
      // reconciliation all land here. Guarding only toggleMic left the lock
      // bypassable, since ServerRoom calls this directly. Muting is never
      // blocked; the lock only stops the microphone being turned ON.
      if (enabled) {
        const store = getStore();
        if (
          !canSelfUnmute(
            { locked: store.hostMuteLocked },
            store.localUser?.role === "host",
          )
        ) {
          return false;
        }
      }
      // MoQ mute is a re-publish with the track dropped, so there is no
      // failure path to report — unlike Fishjam's toggle, which could reject.
      mediaRef.current.setMicEnabled(enabled);
      getStore().setMicOn(enabled);
      audioSession.setMicMuted(!enabled);
      return true;
    },
    [getStore],
  );

  const setCameraEnabled = useCallback(
    async (enabled: boolean) => {
      mediaRef.current.setCameraEnabled(enabled);
      getStore().setCameraOn(enabled);
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
        // Host mute is a LOCK, not a remote microphone switch: muting stops
        // publishing and blocks self-unmute; lifting it restores the
        // participant's control WITHOUT opening their mic. See
        // lib/video/host-mute — this used to call setMicEnabled(true), which
        // let a host open any participant's microphone.
        case "mute_peer":
        case "mute_all":
        case "unmute_peer":
        case "unmute_all": {
          const store = getStore();
          const ctx = {
            isHost: store.localUser?.role === "host",
            targetsSelf: event.targetId === store.localUser?.id,
          };
          const next = applyHostMuteEvent(
            { locked: store.hostMuteLocked },
            event.type,
            ctx,
          );
          if (next.locked !== store.hostMuteLocked) {
            store.setHostMuteLocked(next.locked);
          }
          if (shouldStopMic(event.type, ctx)) {
            console.log("[useVideoRoom] Muted by host");
            void setMicEnabled(false);
          }
          break;
        }
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

          // No media reconnect: the MoQ publish/subscribe tokens carry their
          // own 60s-before-expiry refresh inside `useMoqToken`. This call
          // renews the ROOM session only (and is what surfaces an eject).
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
        onErrorRef.current?.(result.error?.message || "Failed to join room", {
          code: result.error?.code,
          detail: result.error?.detail,
        });
        return false;
      }

      const { room, token, peer, user, expiresAt } = result.data!;

      tokenExpiresAtRef.current = new Date(expiresAt);
      currentJtiRef.current = peer.id;

      // The server's session deadline. Stored, not interpreted — the client
      // timer counts down to it and video_join_room enforces it.
      getStore().setServerEndsAt(room.endsAt ?? null);

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

      // Media needs no explicit join: writing localUser above flips
      // `canPublish`, which mints the MoQ token, connects the session and
      // trips the go-live effect below.
      //
      // Deliberately NOT `mediaRef.current.goLive()` here: mediaRef still
      // holds the PREVIOUS render's hook, where canPublish is false and the
      // token is null, so the call would no-op and the speaker would sit
      // connected but silent.

      // Identity for remote tiles comes from the roster, not from the
      // transport — MoQ paths carry no metadata.
      setMembers(await videoApi.getRoomMembers(roomId));

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
          // Re-read rather than patch: joins, leaves and role changes all land
          // here and the roster is small (max 10 members per room).
          void videoApi.getRoomMembers(roomId).then(setMembers);
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
    mediaRef.current.end();

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
      await setCameraEnabled(!getStore().isCameraOn);
    } finally {
      cameraToggleInFlightRef.current = false;
    }
  }, [setCameraEnabled, getStore]);

  /** Returns false when the host is holding the mute — the caller surfaces
   *  HOST_MUTE_COPY.blocked rather than failing silently. Muting yourself is
   *  always allowed; the lock only blocks turning the microphone ON. */
  const toggleMic = useCallback(async () => {
    if (micToggleInFlightRef.current) return true;
    const store = getStore();
    const wantEnabled = !store.isMicOn;
    if (
      wantEnabled &&
      !canSelfUnmute(
        { locked: store.hostMuteLocked },
        store.localUser?.role === "host",
      )
    ) {
      return false;
    }
    micToggleInFlightRef.current = true;
    try {
      await setMicEnabled(wantEnabled);
    } finally {
      micToggleInFlightRef.current = false;
    }
    return true;
  }, [getStore, setMicEnabled]);

  const switchCamera = useCallback(async () => {
    if (cameraSwitchInFlightRef.current || cameraToggleInFlightRef.current) {
      return;
    }
    cameraSwitchInFlightRef.current = true;
    try {
      // `flip()` is the whole camera-switch API on this transport: it swaps the
      // capture position in native code and the published track follows. The
      // old Fishjam path had to enumerate devices and call selectCamera(id)
      // because its deprecated _switchCamera() read an unset facingMode — none
      // of that applies here. Note the camera is a device SINGLETON: flipping
      // affects every consumer in the process.
      mediaRef.current.cameraTrack.flip();
      // Optimistic; the position effect above reconciles from the track itself.
      getStore().setFrontCamera(!getStore().isFrontCamera);
    } catch (error) {
      console.error("[useVideoRoom] switchCamera failed:", error);
      onErrorRef.current?.("Couldn't reverse camera");
    } finally {
      cameraSwitchInFlightRef.current = false;
    }
  }, [getStore]);

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

  // ── Go live ────────────────────────────────────────────────────────
  // Publishing starts as soon as we hold BOTH a publish-capable role and a
  // minted token. `goLive` no-ops without a token and changes identity when
  // one arrives, so this effect re-runs exactly once more at that point.
  useEffect(() => {
    if (!canPublish || media.isLive) return;
    void media.goLive();
  }, [canPublish, media.isLive, media.goLive]);

  // ── Participants sync ──────────────────────────────────────────────
  // Roster (identity, role, hand) × live MoQ publishers (media), joined on the
  // peer id both sides derive from the user. See `lynk-participants.ts`.
  useEffect(() => {
    getStore().setParticipants(
      mergeParticipants({
        members,
        publishers: media.coPublishers.map((p) => ({
          peerId: p.peerId,
          broadcast: p.broadcast,
          hasVideo: p.broadcast.videoTracks.length > 0,
          hasAudio: p.broadcast.audioTracks.length > 0,
        })),
        localUserId: getStore().localUser?.id,
      }),
    );
  }, [members, media.coPublishers, getStore]);

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
      mediaRef.current.end();
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
    hostMuteLocked: store.hostMuteLocked,
    serverEndsAt: store.serverEndsAt,
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
    // Transport surface the screen needs directly. `camera`/`microphone`/
    // `screenShare` (raw Fishjam hook objects) are gone: capture state is in
    // the store, and MoQ screen share is a separate out-of-process broadcast
    // that nothing publishes yet.
    /** Bind to `<PublisherView camera={...} />` for the local preview. */
    cameraTrack: media.cameraTrack,
    /** Humane transport state — drives "Connecting…" / "Reconnecting…" copy. */
    mediaState: media.state,
    mediaError: media.error,
    isLive: media.isLive,
    canPublish,
  };
}
