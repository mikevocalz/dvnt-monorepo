/**
 * Video Chat API Client
 * Calls Supabase Edge Functions for video room operations
 */

import { supabase } from "@/lib/supabase/client";
import { requireBetterAuthToken } from "@/lib/auth/identity";
import type {
  VideoRoom,
  JoinRoomResponse,
  CreateRoomResponse,
  RefreshTokenResponse,
  RoomMember,
  RoomEvent,
} from "./types";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
    /** Structured detail payload for errors that render rich UX
     *  (currently capacity: { reason, current, max, isHost }). */
    detail?: Record<string, unknown>;
  };
}

const ROOM_UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function resolveRealtimeRoomId(roomId: string): Promise<string | null> {
  if (!ROOM_UUID_REGEX.test(roomId)) {
    return roomId;
  }

  const { data: room } = await supabase
    .from("video_rooms")
    .select("id")
    .eq("uuid", roomId)
    .single();

  return room?.id ? String(room.id) : null;
}

async function callEdgeFunction<T>(
  functionName: string,
  body: Record<string, unknown>,
): Promise<ApiResponse<T>> {
  try {
    const token = await requireBetterAuthToken();

    const { data, error } = await supabase.functions.invoke<ApiResponse<T>>(
      functionName,
      {
        body,
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (error) {
      let message = error.message || "Edge function error";
      const response = (error as any)?.context;

      if (response) {
        try {
          const payload = await response.clone().json();
          console.error(
            `[VideoApi] ${functionName} http error payload:`,
            payload,
          );
          message =
            payload?.error?.message ||
            payload?.message ||
            `${response.status} ${response.statusText}` ||
            message;
        } catch {
          try {
            const text = await response.clone().text();
            console.error(`[VideoApi] ${functionName} http error text:`, text);
            message =
              text || `${response.status} ${response.statusText}` || message;
          } catch {
            console.error(`[VideoApi] ${functionName} invoke error:`, error);
            console.error(
              `[VideoApi] ${functionName} error details:`,
              JSON.stringify(error),
            );
          }
        }
      } else {
        console.error(`[VideoApi] ${functionName} invoke error:`, error);
        console.error(
          `[VideoApi] ${functionName} error details:`,
          JSON.stringify(error),
        );
      }

      return {
        ok: false,
        error: {
          code: "internal_error",
          message,
        },
      };
    }

    // Log the raw response for debugging
    if (!data || (data as any)?.ok === false) {
      console.error(
        `[VideoApi] ${functionName} returned not-ok:`,
        JSON.stringify(data),
      );
    }

    return data as ApiResponse<T>;
  } catch (err: any) {
    console.error(`[VideoApi] ${functionName} error:`, err);
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: err.message || "Network error",
      },
    };
  }
}

export const videoApi = {
  /**
   * Create a new video room
   */
  async createRoom(params: {
    title: string;
    isPublic?: boolean;
    maxParticipants?: number;
  }): Promise<ApiResponse<CreateRoomResponse>> {
    return callEdgeFunction<CreateRoomResponse>("video_create_room", params);
  },

  /**
   * Join a video room and get Fishjam token
   */
  async joinRoom(
    roomId: string,
    anonymous = false,
  ): Promise<ApiResponse<JoinRoomResponse>> {
    return callEdgeFunction<JoinRoomResponse>("video_join_room", {
      roomId,
      anonymous,
    });
  },

  /**
   * Refresh Fishjam token for an active session
   */
  async refreshToken(
    roomId: string,
    currentJti?: string,
  ): Promise<ApiResponse<RefreshTokenResponse>> {
    return callEdgeFunction<RefreshTokenResponse>("video_refresh_token", {
      roomId,
      currentJti,
    });
  },

  /**
   * Kick a user from the room (temporary)
   */
  async kickUser(params: {
    roomId: string;
    targetUserId: string;
    reason?: string;
  }): Promise<ApiResponse<{ kicked: boolean }>> {
    return callEdgeFunction("video_kick_user", params);
  },

  /**
   * Ban a user from the room (persistent)
   */
  async banUser(params: {
    roomId: string;
    targetUserId: string;
    reason?: string;
    durationMinutes?: number;
  }): Promise<ApiResponse<{ banned: boolean; expiresAt?: string }>> {
    return callEdgeFunction("video_ban_user", params);
  },

  /**
   * Change a user's role (host only)
   */
  async changeRole(params: {
    roomId: string;
    targetUserId: string;
    newRole: "co-host" | "participant";
  }): Promise<ApiResponse<{ changed: boolean; role: string }>> {
    return callEdgeFunction("video_change_role", params);
  },

  /**
   * Mute a participant (host/co-host)
   */
  async mutePeer(params: {
    roomId: string;
    targetUserId: string;
  }): Promise<ApiResponse<{ muted: boolean }>> {
    return callEdgeFunction("video_mute_peer", params);
  },

  /**
   * Mute ALL participants (host only)
   */
  async muteAll(roomId: string): Promise<ApiResponse<{ mutedAll: boolean }>> {
    return callEdgeFunction("video_mute_all", { roomId, action: "mute" });
  },

  /**
   * Unmute ALL participants (host only)
   */
  async unmuteAll(
    roomId: string,
  ): Promise<ApiResponse<{ unmutedAll: boolean }>> {
    return callEdgeFunction("video_mute_all", { roomId, action: "unmute" });
  },

  /**
   * Request a participant to unmute (host/co-host sends unmute_peer event)
   */
  async unmutePeer(params: {
    roomId: string;
    targetUserId: string;
  }): Promise<ApiResponse<{ unmuted: boolean }>> {
    return callEdgeFunction("video_mute_peer", { ...params, action: "unmute" });
  },

  /**
   * End the room (host only)
   */
  async endRoom(roomId: string): Promise<ApiResponse<{ ended: boolean }>> {
    return callEdgeFunction("video_end_room", { roomId });
  },

  /**
   * Get room details
   */
  async getRoom(roomId: string): Promise<VideoRoom | null> {
    const { data, error } = await supabase
      .from("video_rooms")
      .select("*")
      .eq("id", roomId)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      title: data.title,
      sweetSpicyMode: data.sweet_spicy_mode || "sweet",
      isPublic: data.is_public,
      status: data.status,
      maxParticipants: data.max_participants,
      fishjamRoomId: data.fishjam_room_id,
      createdBy: data.created_by,
      createdAt: data.created_at,
      endedAt: data.ended_at,
    };
  },

  /**
   * Get room members
   */
  async getRoomMembers(roomId: string): Promise<RoomMember[]> {
    const internalRoomId = await resolveRealtimeRoomId(roomId);
    if (!internalRoomId) return [];

    const { data, error } = await supabase
      .from("video_room_members")
      .select(
        `
        room_id,
        user_id,
        role,
        status,
        hand_raised,
        joined_at,
        left_at,
        users!inner(username, avatar)
      `,
      )
      .eq("room_id", internalRoomId)
      .eq("status", "active");

    if (error || !data) return [];

    return data.map((m: any) => ({
      roomId: m.room_id,
      userId: m.user_id,
      role: m.role,
      status: m.status,
      handRaised: !!m.hand_raised,
      joinedAt: m.joined_at,
      leftAt: m.left_at,
      username: m.users?.username,
      avatar: m.users?.avatar?.url,
    }));
  },

  /**
   * Get public rooms
   */
  async getPublicRooms(): Promise<VideoRoom[]> {
    const { data, error } = await supabase
      .from("video_rooms")
      .select("*")
      .eq("is_public", true)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(50);

    if (error || !data) return [];

    return data.map((r) => ({
      id: r.id,
      title: r.title,
      sweetSpicyMode: r.sweet_spicy_mode || "sweet",
      isPublic: r.is_public,
      status: r.status,
      maxParticipants: r.max_participants,
      fishjamRoomId: r.fishjam_room_id,
      createdBy: r.created_by,
      createdAt: r.created_at,
      endedAt: r.ended_at,
    }));
  },

  /**
   * Get user's rooms (as member)
   */
  async getMyRooms(): Promise<VideoRoom[]> {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return [];

    const { data, error } = await supabase
      .from("video_room_members")
      .select(
        `
        video_rooms!inner(*)
      `,
      )
      .eq("user_id", user.id)
      .eq("status", "active")
      .eq("video_rooms.status", "open");

    if (error || !data) return [];

    return data.map((m: any) => ({
      id: m.video_rooms.id,
      title: m.video_rooms.title,
      sweetSpicyMode: m.video_rooms.sweet_spicy_mode || "sweet",
      isPublic: m.video_rooms.is_public,
      status: m.video_rooms.status,
      maxParticipants: m.video_rooms.max_participants,
      fishjamRoomId: m.video_rooms.fishjam_room_id,
      createdBy: m.video_rooms.created_by,
      createdAt: m.video_rooms.created_at,
      endedAt: m.video_rooms.ended_at,
    }));
  },

  /**
   * Subscribe to room events (for kick/ban/end notifications)
   */
  subscribeToRoomEvents(
    roomId: string,
    userId: string,
    onEvent: (event: RoomEvent) => void,
  ) {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      const realtimeRoomId = await resolveRealtimeRoomId(roomId);
      if (!realtimeRoomId || cancelled) return;

      channel = supabase
        .channel(`video_room_events:${realtimeRoomId}`)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "video_room_events",
            filter: `room_id=eq.${realtimeRoomId}`,
          },
          (payload) => {
            const event = payload.new as any;
            // Only process events targeting this user or room-wide events
            if (
              !event.target_id ||
              event.target_id === userId ||
              event.type === "room_ended"
            ) {
              onEvent({
                id: event.id,
                roomId: event.room_id,
                type: event.type,
                actorId: event.actor_id,
                targetId: event.target_id,
                payload: event.payload,
                createdAt: event.created_at,
              });
            }
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  },

  /**
   * Subscribe to member changes
   */
  subscribeToMembers(
    roomId: string,
    onMemberChange: (
      member: RoomMember,
      eventType: "INSERT" | "UPDATE" | "DELETE",
    ) => void,
  ) {
    let channel: ReturnType<typeof supabase.channel> | null = null;
    let cancelled = false;

    void (async () => {
      const realtimeRoomId = await resolveRealtimeRoomId(roomId);
      if (!realtimeRoomId || cancelled) return;

      channel = supabase
        .channel(`video_room_members:${realtimeRoomId}`)
        .on(
          "postgres_changes",
          {
            event: "*",
            schema: "public",
            table: "video_room_members",
            filter: `room_id=eq.${realtimeRoomId}`,
          },
          async (payload) => {
            const member = (payload.new || payload.old) as any;
            const isAnonymous = member.is_anonymous ?? false;
            const anonLabel = member.anon_label ?? null;

            let userData: {
              username?: string;
              first_name?: string;
              avatar?: { url?: string }[] | { url?: string } | null;
            } | null = null;

            if (!isAnonymous) {
              const { data } = await supabase
                .from("users")
                .select("username, first_name, avatar:avatar_id(url)")
                .eq("auth_id", member.user_id)
                .single();
              userData = data;
            }

            onMemberChange(
              {
                roomId: member.room_id,
                userId: member.user_id,
                role: member.role,
                status: member.status,
                handRaised: !!member.hand_raised,
                joinedAt: member.joined_at,
                leftAt: member.left_at,
                username: isAnonymous
                  ? anonLabel || "Anon"
                  : userData?.username || undefined,
                displayName: isAnonymous
                  ? anonLabel || "Anon"
                  : userData?.first_name || userData?.username || undefined,
                avatar: isAnonymous
                  ? undefined
                  : Array.isArray(userData?.avatar)
                    ? userData?.avatar[0]?.url
                    : userData?.avatar?.url,
                isAnonymous,
                anonLabel,
              },
              payload.eventType as "INSERT" | "UPDATE" | "DELETE",
            );
          },
        )
        .subscribe();
    })();

    return () => {
      cancelled = true;
      if (channel) {
        supabase.removeChannel(channel);
      }
    };
  },
};
