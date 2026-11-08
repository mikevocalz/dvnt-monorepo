/**
 * Sneaky Lynk API Client
 * Calls Supabase Edge Functions for room management
 */

import { Platform } from "react-native";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { requireBetterAuthToken } from "@dvnt/app/lib/auth/identity";
import type { CreateRoomParams, JoinRoomResponse, SneakyRoom } from "../types";
import {
  MEMBER_STAT_COLUMNS,
  buildRoomParticipantStats,
  resolveRoomAudience,
  toMemberStatRow,
} from "./room-stats";

type ErrorCode =
  | "cancelled"
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "rate_limited"
  | "validation_error"
  | "internal_error";

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: {
    code: ErrorCode;
    message: string;
    /** Structured detail — populated for errors that render rich UX
     *  (currently capacity). Forward-compatible: unknown keys are safe. */
    detail?: Record<string, unknown>;
  };
}

async function callEdgeFunction<T>(
  functionName: string,
  body: Record<string, unknown>,
  options?: { isCurrent?: () => boolean },
): Promise<ApiResponse<T>> {
  const cancelled = (): ApiResponse<T> => ({ ok: false, error: { code: "cancelled", message: "Request no longer belongs to this room entry" } });
  try {
    if (options?.isCurrent && !options.isCurrent()) return cancelled();
    const token = await requireBetterAuthToken();
    // Authentication can change while token refresh is pending. Never dispatch
    // an old admission or its cleanup using a different account's credential.
    if (options?.isCurrent && !options.isCurrent()) return cancelled();

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
            `[SneakyLynk] ${functionName} http error payload:`,
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
            console.error(
              `[SneakyLynk] ${functionName} http error text:`,
              text,
            );
            message =
              text || `${response.status} ${response.statusText}` || message;
          } catch {
            console.error(
              `[SneakyLynk] ${functionName} invoke error without readable body:`,
              error,
            );
          }
        }
      } else {
        console.error(`[SneakyLynk] ${functionName} invoke error:`, error);
      }

      return {
        ok: false,
        error: {
          code: "internal_error",
          message,
        },
      };
    }

    return data as ApiResponse<T>;
  } catch (err: any) {
    console.error(`[SneakyLynk] ${functionName} error:`, err);
    return {
      ok: false,
      error: {
        code: "internal_error",
        message: err.message || "Network error",
      },
    };
  }
}

export const sneakyLynkApi = {
  /**
   * Create a new Sneaky Lynk room
   * Uses existing video_create_room Edge Function
   */
  async createRoom(
    params: CreateRoomParams,
    options?: { isCurrent?: () => boolean },
  ): Promise<ApiResponse<{ room: SneakyRoom }>> {
    return callEdgeFunction("video_create_room", {
      title: params.title,
      topic: params.topic || "",
      description: params.description || "",
      hasVideo: params.hasVideo ?? false,
      isPublic: params.isPublic ?? true,
      invitedUserIds: params.invitedUserIds ?? [],
      appOnly: params.appOnly ?? false,
      maxParticipants: 50,
    }, options);
  },

  /**
   * Join a room and get Fishjam token
   * Uses existing video_join_room Edge Function
   *
   * Sends the client platform so the edge function can enforce app-only rooms
   * BEFORE minting a peer token. `Platform.OS` is "web" under react-native-web,
   * which is exactly the signal the gate keys off. This is a client-declared
   * value — see the JoinRoomSchema docstring in
   * `supabase/functions/video_join_room/index.ts` for the (acknowledged)
   * spoofing limit.
   */
  async joinRoom(
    roomId: string,
    anonymous = false,
    options?: { isCurrent?: () => boolean },
  ): Promise<ApiResponse<JoinRoomResponse>> {
    return callEdgeFunction("video_join_room", {
      roomId,
      anonymous,
      platform: Platform.OS,
    }, options);
  },

  /**
   * Refresh Fishjam token
   * Uses existing video_refresh_token Edge Function
   */
  async refreshToken(
    roomId: string,
  ): Promise<ApiResponse<{ token: string; expiresAt: string }>> {
    return callEdgeFunction("video_refresh_token", { roomId });
  },

  /**
   * Kick a user from the room (host/moderator only)
   * Uses existing video_kick_user Edge Function
   */
  async kickUser(
    roomId: string,
    targetUserId: string,
    reason?: string,
  ): Promise<ApiResponse<void>> {
    return callEdgeFunction("video_kick_user", {
      roomId,
      targetUserId,
      reason,
    });
  },

  /**
   * Ban a user from the room (host/moderator only)
   * Uses existing video_ban_user Edge Function
   */
  async banUser(
    roomId: string,
    targetUserId: string,
    reason?: string,
  ): Promise<ApiResponse<void>> {
    return callEdgeFunction("video_ban_user", { roomId, targetUserId, reason });
  },

  /**
   * Leave a room (any participant)
   * Marks member as "left", decrements participant_count, auto-ends if empty
   */
  async leaveRoom(roomId: string, options?: { isCurrent?: () => boolean }): Promise<
    ApiResponse<{
      left: boolean;
      roomEnded: boolean;
      remainingParticipants: number;
    }>
  > {
    return callEdgeFunction("video_leave_room", { roomId }, options);
  },

  /**
   * End the room (host only)
   * Uses existing video_end_room Edge Function
   */
  async endRoom(roomId: string): Promise<ApiResponse<void>> {
    return callEdgeFunction("video_end_room", { roomId });
  },

  /**
   * Presence heartbeat — keeps this member's freshness current so the room
   * reads as genuinely live. Called on a 30s interval while connected.
   */
  async heartbeat(roomId: string): Promise<ApiResponse<{ ok: boolean }>> {
    return callEdgeFunction("video_heartbeat", { roomId });
  },

  /**
   * Raise/lower hand
   */
  async toggleHand(
    roomId: string,
    raised: boolean,
  ): Promise<ApiResponse<void>> {
    return callEdgeFunction("video_toggle_hand", { roomId, raised });
  },

  /**
   * Get recent rooms list.
   * Includes public rooms plus invite-only rooms available to the current user.
   */
  async getLiveRooms(options?: { isCurrent?: () => boolean }): Promise<SneakyRoom[]> {
    const checkOwner = () => {
      if (options?.isCurrent && !options.isCurrent()) throw new Error("Discovery account changed");
    };
    // Start before authentication, not receipt: slow responses must not renew a lease.
    const requestStartedAt = Date.now();
    const requestStartedMonotonic = globalThis.performance?.now?.() ?? NaN;
    try {
      checkOwner();
      const response = await callEdgeFunction<{ rooms: SneakyRoom[] }>(
        "video_list_rooms", { discoveryVersion: 2 }, options,
      );
      checkOwner();
      if (!response.ok || !Array.isArray(response.data?.rooms)) throw new Error(response.error?.message || "Invalid discovery response");
      const validTime = (value: unknown) => typeof value === "string" && Number.isFinite(Date.parse(value));
      if (response.data.rooms.some((room) => !["live", "inactive", "scheduled", "ended", "unknown"].includes(room.availability ?? "") ||
        typeof room.presenceKnown !== "boolean" || typeof room.isOwner !== "boolean" || typeof room.isInvited !== "boolean" ||
        !validTime(room.observedAt) || (room.presenceExpiresAt !== null && !validTime(room.presenceExpiresAt)) ||
        (room.endsAt !== null && !validTime(room.endsAt)))) {
        throw new Error("Discovery server must support version 2");
      }
      return response.data.rooms.map((room) => ({ ...room, requestStartedAt, requestStartedMonotonic }));
    } catch (error) {
      console.error("[SneakyLynk] getLiveRooms error:", error);
      throw new Error("Lynks could not be loaded. Please try again.");
    }
  },

  /**
   * Get room by ID
   */
  async getRoomById(
    roomId: string,
    options?: { throwOnError?: boolean },
  ): Promise<SneakyRoom | null> {
    try {
      // Try uuid first (new rooms), fall back to integer id (legacy)
      const isUuid =
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
          roomId,
        );
      const lookupColumn = isUuid ? "uuid" : "id";
      const { data, error } = await supabase
        .from("video_rooms")
        .select("*")
        .eq(lookupColumn, roomId)
        .single();

      if (error) {
        if (error.code === "PGRST116") return null;
        throw error;
      }
      if (!data) return null;

      // Lookup creator by auth_id (no FK on created_by)
      let creator: any = null;
      if (data.created_by) {
        const { data: creatorData } = await supabase
          .from("users")
          .select(
            "id, auth_id, username, first_name, avatar:avatar_id(url), verified",
          )
          .eq("auth_id", data.created_by)
          .single();
        creator = creatorData;
      }

      const { data: members } = await supabase
        .from("video_room_members")
        .select(MEMBER_STAT_COLUMNS)
        .eq("room_id", data.id);

      const roomStats = buildRoomParticipantStats(
        (members || []).map(toMemberStatRow),
        Date.now(),
      );
      const audience = resolveRoomAudience(
        {
          id: data.id,
          status: data.status as "open" | "ended",
          participant_count: data.participant_count,
          created_at: data.created_at,
        },
        roomStats[data.id],
        Date.now(),
      );

      return {
        id: data.uuid || String(data.id),
        createdBy: data.created_by || "",
        title: data.title || "Untitled Lynk",
        topic: data.topic || "",
        description: data.description || "",
        sweetSpicyMode: data.sweet_spicy_mode || "sweet",
        isLive: audience.isLive,
        hasVideo: data.has_video ?? false,
        isPublic: data.is_public ?? true,
        status: data.status as "open" | "ended",
        createdAt: data.created_at,
        endedAt: data.ended_at || undefined,
        // The server's session deadline. A room can be `status: "open"` and
        // still refuse every join with `session_expired`, so callers that ask
        // "can anyone get in?" need this, not just the status.
        endsAt: data.ends_at || null,
        host: {
          id: String(creator?.id || ""),
          username: creator?.username || "unknown",
          displayName: creator?.first_name || creator?.username || "unknown",
          avatar: (creator?.avatar as any)?.url || "",
          isVerified: creator?.verified || false,
        },
        speakers: [],
        listeners: audience.listeners,
        fishjamRoomId: data.fishjam_room_id || undefined,
      };
    } catch (error) {
      console.error("[SneakyLynk] getRoomById error:", error);
      if (options?.throwOnError) throw new Error("Couldn't load this Lynk. Please try again.");
      return null;
    }
  },
};
