/**
 * Sneaky Lynk Room Hook
 * Manages room state, RTC connection, and participants
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { AppState, AppStateStatus } from "react-native";
import { sneakyLynkApi } from "../api/supabase";
import { useRoomEvents } from "./useRoomEvents";
import {
  classifySneakyLynkError,
  type ClassifiedError,
} from "../errors";
import {
  getFishjamClient,
  resetFishjamClient,
  type FishjamPeer,
} from "../rtc/fishjamClient";
import type {
  ConnectionState,
  MemberRole,
  SneakyUser,
  EjectPayload,
  RoomEvent,
} from "../types";

interface RoomParticipant {
  id: string;
  peerId?: string;
  user: SneakyUser;
  role: MemberRole;
  isSpeaking: boolean;
  hasVideo: boolean;
  isMuted: boolean;
}

interface RoomState {
  id: string;
  title: string;
  topic: string;
  description: string;
  hasVideo: boolean;
  fishjamRoomId: string;
}

interface UseSneakyLynkRoomReturn {
  // State
  room: RoomState | null;
  connectionState: ConnectionState;
  participants: RoomParticipant[];
  speakers: RoomParticipant[];
  listeners: RoomParticipant[];
  featuredSpeaker: RoomParticipant | null;
  activeSpeakers: Set<string>;
  myRole: MemberRole;

  // Local controls
  isMuted: boolean;
  isVideoEnabled: boolean;
  handRaised: boolean;

  // Actions
  toggleMute: () => Promise<void>;
  toggleVideo: () => Promise<void>;
  toggleHand: () => Promise<void>;
  setFeaturedSpeaker: (userId: string) => void;
  leaveRoom: () => Promise<void>;

  // Moderation
  kickUser: (userId: string, reason?: string) => Promise<void>;
  banUser: (userId: string, reason?: string) => Promise<void>;
  endRoom: () => Promise<void>;

  // Eject state
  isEjected: boolean;
  ejectReason: EjectPayload | null;
  isRoomEnded: boolean;

  // Errors
  error: string | null;
  /** UI-ready classified error. Use this to render sheets; `error` is legacy. */
  classifiedError: ClassifiedError | null;
  /** Dismiss the current classified error (hides the error sheet). */
  dismissClassifiedError: () => void;
}

export function useSneakyLynkRoom(
  roomId: string,
  userId: string,
): UseSneakyLynkRoomReturn {
  // Room state
  const [room, setRoom] = useState<RoomState | null>(null);
  const [connectionState, setConnectionState] =
    useState<ConnectionState>("disconnected");
  const [participants, setParticipants] = useState<RoomParticipant[]>([]);
  const [activeSpeakers, setActiveSpeakers] = useState<Set<string>>(new Set());
  const [featuredSpeakerId, setFeaturedSpeakerId] = useState<string | null>(
    null,
  );
  const [myRole, setMyRole] = useState<MemberRole>("listener");

  // Local controls
  const [isMuted, setIsMuted] = useState(true);
  const [isVideoEnabled, setIsVideoEnabled] = useState(false);
  const [handRaised, setHandRaised] = useState(false);

  // Eject/end state
  const [isEjected, setIsEjected] = useState(false);
  const [ejectReason, setEjectReason] = useState<EjectPayload | null>(null);
  const [isRoomEnded, setIsRoomEnded] = useState(false);

  // Error state
  const [error, setError] = useState<string | null>(null);
  // Typed, UI-ready classification of the most recent join failure.
  // Preferred by screens over the raw `error` string — routes to the
  // right polished sheet per reason (room full, ended, rate-limited, …).
  const [classifiedError, setClassifiedError] =
    useState<ClassifiedError | null>(null);

  // Refs
  const tokenExpiresAt = useRef<Date | null>(null);
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appStateRef = useRef<AppStateStatus>(AppState.currentState);

  // Derived state
  const speakers = participants.filter(
    (p) => p.role === "host" || p.role === "moderator" || p.role === "speaker",
  );
  const listeners = participants.filter((p) => p.role === "listener");
  const featuredSpeaker = featuredSpeakerId
    ? (participants.find((p) => p.user.id === featuredSpeakerId) ??
      speakers[0] ??
      null)
    : (speakers[0] ?? null);

  // Room events handlers
  const handleMemberJoined = useCallback((event: RoomEvent) => {
    console.log("[SneakyLynk] Member joined:", event);
    // TODO: Add participant to list from event payload
  }, []);

  const handleMemberLeft = useCallback((event: RoomEvent) => {
    console.log("[SneakyLynk] Member left:", event);
    setParticipants((prev) => prev.filter((p) => p.user.id !== event.actorId));
  }, []);

  const handleEject = useCallback((payload: EjectPayload) => {
    console.log("[SneakyLynk] Ejected:", payload);
    setIsEjected(true);
    setEjectReason(payload);

    // Disconnect from Fishjam
    const client = getFishjamClient();
    client.disconnect();
  }, []);

  const handleRoomEnded = useCallback(() => {
    console.log("[SneakyLynk] Room ended");
    setIsRoomEnded(true);

    // Disconnect from Fishjam
    const client = getFishjamClient();
    client.disconnect();
  }, []);

  // Subscribe to room events
  useRoomEvents({
    roomId,
    userId,
    onMemberJoined: handleMemberJoined,
    onMemberLeft: handleMemberLeft,
    onEject: handleEject,
    onRoomEnded: handleRoomEnded,
  });

  // Join room on mount
  useEffect(() => {
    if (!roomId || !userId) return;

    let mounted = true;

    const joinRoom = async () => {
      setConnectionState("connecting");
      setError(null);
      setClassifiedError(null);

      try {
        const response = await sneakyLynkApi.joinRoom(roomId);

        if (!mounted) return;

        if (!response.ok || !response.data) {
          const rawMessage = response.error?.message ?? "Failed to join room";
          const classified = classifySneakyLynkError(
            response.error?.code,
            rawMessage,
          );
          // Keep the legacy string field populated for any old consumer,
          // but screens should render off `classifiedError` going forward.
          setError(rawMessage);
          setClassifiedError(classified);
          setConnectionState("disconnected");
          return;
        }

        const { room: roomData, token, peer, expiresAt } = response.data;

        setRoom({
          id: roomData.id,
          title: roomData.title,
          topic: roomData.topic,
          description: roomData.description,
          hasVideo: roomData.hasVideo,
          fishjamRoomId: roomData.fishjamRoomId,
        });
        setMyRole(peer.role);
        tokenExpiresAt.current = new Date(expiresAt);

        // Connect to Fishjam
        const client = getFishjamClient();

        client.on("connected", () => {
          if (mounted) setConnectionState("connected");
        });

        client.on("disconnected", () => {
          if (mounted) setConnectionState("disconnected");
        });

        client.on("reconnecting", () => {
          if (mounted) setConnectionState("reconnecting");
        });

        client.on("active_speaker", (event) => {
          if (mounted && event.activeSpeakerId) {
            setActiveSpeakers(new Set([event.activeSpeakerId]));
          }
        });

        client.on("peer_joined", (event) => {
          if (mounted && event.peer) {
            // Add peer to participants
            const peer = event.peer;
            setParticipants((prev) => {
              // CRITICAL: Deduplicate by BOTH peerId AND userId to prevent duplicates on reconnect
              const existingByPeerId = prev.find((p) => p.peerId === peer.id);
              const existingByUserId = prev.find(
                (p) => p.id === peer.metadata.userId,
              );

              if (existingByPeerId) {
                // Same peerId - already have this exact peer
                return prev;
              }

              if (existingByUserId) {
                // Same user reconnecting with new peerId - update existing entry
                return prev.map((p) =>
                  p.id === peer.metadata.userId
                    ? {
                        ...p,
                        peerId: peer.id,
                        hasVideo: peer.tracks.some((t) => t.type === "video"),
                        isMuted: !peer.tracks.some(
                          (t) => t.type === "audio" && t.enabled,
                        ),
                      }
                    : p,
                );
              }

              // New user - add to list
              return [
                ...prev,
                {
                  id: peer.metadata.userId,
                  peerId: peer.id,
                  user: {
                    id: peer.metadata.userId,
                    username: "user",
                    displayName: "User",
                    avatar: `https://i.pravatar.cc/150?u=${peer.metadata.userId}`,
                    isVerified: false,
                  },
                  role: peer.metadata.role,
                  isSpeaking: false,
                  hasVideo: peer.tracks.some((t) => t.type === "video"),
                  isMuted: !peer.tracks.some(
                    (t) => t.type === "audio" && t.enabled,
                  ),
                },
              ];
            });
          }
        });

        client.on("peer_left", (event) => {
          if (mounted && event.peer) {
            setParticipants((prev) =>
              prev.filter((p) => p.peerId !== event.peer!.id),
            );
          }
        });

        await client.connect({
          serverUrl: process.env.EXPO_PUBLIC_FISHJAM_URL ?? "",
          token,
          roomId: roomData.fishjamRoomId,
        });

        // Schedule token refresh
        scheduleTokenRefresh();
      } catch (err) {
        console.error("[SneakyLynk] Join error:", err);
        if (mounted) {
          setError("Failed to join room");
          setConnectionState("disconnected");
        }
      }
    };

    joinRoom();

    return () => {
      mounted = false;
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
    };
  }, [roomId, userId]);

  // Presence heartbeat: while connected, refresh our membership freshness every
  // 30s so video_list_rooms knows the room is genuinely live. Without this, a
  // host who closes the tab/app without a clean leave keeps the room showing
  // "LIVE" for hours (the freshness window). When heartbeats stop, the room goes
  // dark within ~90s.
  useEffect(() => {
    if (!roomId || connectionState !== "connected") return;
    let alive = true;
    const beat = () => {
      if (alive) void sneakyLynkApi.heartbeat(roomId).catch(() => {});
    };
    beat();
    const id = setInterval(beat, 30_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [roomId, connectionState]);

  // Handle app state changes for token refresh
  useEffect(() => {
    const subscription = AppState.addEventListener("change", (nextState) => {
      if (
        appStateRef.current.match(/inactive|background/) &&
        nextState === "active"
      ) {
        // App came to foreground - check if token needs refresh
        if (tokenExpiresAt.current) {
          const now = new Date();
          const timeUntilExpiry =
            tokenExpiresAt.current.getTime() - now.getTime();
          if (timeUntilExpiry < 5 * 60 * 1000) {
            // Less than 5 minutes - refresh now
            refreshToken();
          }
        }
      }
      appStateRef.current = nextState;
    });

    return () => subscription.remove();
  }, []);

  const scheduleTokenRefresh = useCallback(() => {
    if (!tokenExpiresAt.current) return;

    const now = new Date();
    const timeUntilExpiry = tokenExpiresAt.current.getTime() - now.getTime();
    // Refresh 5 minutes before expiry
    const refreshIn = Math.max(timeUntilExpiry - 5 * 60 * 1000, 0);

    console.log(
      "[SneakyLynk] Scheduling token refresh in",
      refreshIn / 1000,
      "seconds",
    );

    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    refreshTimeoutRef.current = setTimeout(() => {
      refreshToken();
    }, refreshIn);
  }, []);

  const refreshToken = useCallback(async () => {
    if (!roomId) return;

    console.log("[SneakyLynk] Refreshing token");

    try {
      const response = await sneakyLynkApi.refreshToken(roomId);

      if (response.ok && response.data) {
        tokenExpiresAt.current = new Date(response.data.expiresAt);
        scheduleTokenRefresh();
        console.log("[SneakyLynk] Token refreshed");
      } else {
        console.error("[SneakyLynk] Token refresh failed:", response.error);
      }
    } catch (err) {
      console.error("[SneakyLynk] Token refresh error:", err);
    }
  }, [roomId, scheduleTokenRefresh]);

  // Actions
  const toggleMute = useCallback(async () => {
    const client = getFishjamClient();

    if (isMuted) {
      await client.enableAudio();
      setIsMuted(false);
    } else {
      await client.disableAudio();
      setIsMuted(true);
    }
  }, [isMuted]);

  const toggleVideo = useCallback(async () => {
    if (!room?.hasVideo) return;

    const client = getFishjamClient();

    if (isVideoEnabled) {
      await client.disableVideo();
      setIsVideoEnabled(false);
    } else {
      await client.enableVideo();
      setIsVideoEnabled(true);
    }
  }, [isVideoEnabled, room?.hasVideo]);

  const toggleHand = useCallback(async () => {
    const newState = !handRaised;
    setHandRaised(newState);

    try {
      await sneakyLynkApi.toggleHand(roomId, newState);
    } catch (err) {
      console.error("[SneakyLynk] Toggle hand error:", err);
      setHandRaised(!newState); // Revert on error
    }
  }, [roomId, handRaised]);

  const setFeaturedSpeaker = useCallback((id: string) => {
    setFeaturedSpeakerId(id);
  }, []);

  const leaveRoom = useCallback(async () => {
    console.log("[SneakyLynk] Leaving room");

    if (refreshTimeoutRef.current) {
      clearTimeout(refreshTimeoutRef.current);
    }

    // CRITICAL: Notify backend BEFORE disconnecting so participant_count is decremented
    // and the room auto-ends if no participants remain
    try {
      const res = await sneakyLynkApi.leaveRoom(roomId);
      if (res.ok) {
        console.log(
          `[SneakyLynk] Left room (remaining: ${res.data?.remainingParticipants}, ended: ${res.data?.roomEnded})`,
        );
      } else {
        console.error("[SneakyLynk] Leave API error:", res.error?.message);
      }
    } catch (err) {
      console.error("[SneakyLynk] Leave API call failed:", err);
    }

    const client = getFishjamClient();
    await client.disconnect();
    resetFishjamClient();
  }, [roomId]);

  // Moderation actions
  const kickUser = useCallback(
    async (targetUserId: string, reason?: string) => {
      if (myRole !== "host" && myRole !== "moderator") {
        setError("You don't have permission to kick users");
        return;
      }

      try {
        const response = await sneakyLynkApi.kickUser(
          roomId,
          targetUserId,
          reason,
        );
        if (!response.ok) {
          setError(response.error?.message ?? "Failed to kick user");
        }
      } catch (err) {
        console.error("[SneakyLynk] Kick error:", err);
        setError("Failed to kick user");
      }
    },
    [roomId, myRole],
  );

  const banUser = useCallback(
    async (targetUserId: string, reason?: string) => {
      if (myRole !== "host" && myRole !== "moderator") {
        setError("You don't have permission to ban users");
        return;
      }

      try {
        const response = await sneakyLynkApi.banUser(
          roomId,
          targetUserId,
          reason,
        );
        if (!response.ok) {
          setError(response.error?.message ?? "Failed to ban user");
        }
      } catch (err) {
        console.error("[SneakyLynk] Ban error:", err);
        setError("Failed to ban user");
      }
    },
    [roomId, myRole],
  );

  const endRoom = useCallback(async () => {
    if (myRole !== "host") {
      setError("Only the host can end the room");
      return;
    }

    try {
      const response = await sneakyLynkApi.endRoom(roomId);
      if (!response.ok) {
        setError(response.error?.message ?? "Failed to end room");
      }
    } catch (err) {
      console.error("[SneakyLynk] End room error:", err);
      setError("Failed to end room");
    }
  }, [roomId, myRole]);

  return {
    room,
    connectionState,
    participants,
    speakers,
    listeners,
    featuredSpeaker,
    activeSpeakers,
    myRole,
    isMuted,
    isVideoEnabled,
    handRaised,
    toggleMute,
    toggleVideo,
    toggleHand,
    setFeaturedSpeaker,
    leaveRoom,
    kickUser,
    banUser,
    endRoom,
    isEjected,
    ejectReason,
    isRoomEnded,
    error,
    classifiedError,
    dismissClassifiedError: () => setClassifiedError(null),
  };
}
