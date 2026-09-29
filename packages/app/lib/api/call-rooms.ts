/**
 * Personal Call Rooms API
 *
 * Thin client for the call_create / call_join edge functions (WS-1: personal
 * Calls split from Sneaky Lynk rooms). Deliberately standalone — does not
 * import from features/video/* — so the call stack and Lynk stack stay
 * decoupled at the module boundary, not just the data-model one.
 */

import { supabase } from "../supabase/client";
import { requireBetterAuthToken } from "../auth/identity";
import { callErrorMessage } from "./call-error-message";

interface ApiResponse<T> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

export interface CallCreateResponse {
  room: { id: string; title: string; fishjamRoomId?: string };
}

export interface CallJoinResponse {
  room: { id: string; title: string; fishjamRoomId: string };
  token: string;
  user: { id: string; username?: string; avatar?: string };
}

async function callEdgeFunction<T>(
  functionName: "call_create" | "call_join" | "video_leave_room",
  body: Record<string, unknown>,
): Promise<ApiResponse<T>> {
  try {
    const token = await requireBetterAuthToken();
    const { data, error } = await supabase.functions.invoke<ApiResponse<T>>(
      functionName,
      { body, headers: { Authorization: `Bearer ${token}` } },
    );

    if (error) {
      console.error(`[callRoomsApi] ${functionName} invoke error:`, error);
      return { ok: false, error: { code: "internal_error", message: error.message } };
    }
    return data as ApiResponse<T>;
  } catch (err: any) {
    console.error(`[callRoomsApi] ${functionName} error:`, err);
    return {
      ok: false,
      error: { code: "internal_error", message: err.message || "Network error" },
    };
  }
}

export const callRoomsApi = {
  async createCall(params: {
    title: string;
    participantIds: string[];
    hasVideo?: boolean;
    maxParticipants?: number;
  }): Promise<ApiResponse<CallCreateResponse>> {
    if (params.participantIds.length < 1 || params.participantIds.length > 3 ||
        new Set(params.participantIds).size !== params.participantIds.length) {
      return { ok: false, error: { code: "validation_error", message: "Choose one to three people to call" } };
    }
    return callEdgeFunction<CallCreateResponse>("call_create", { ...params, maxParticipants: 4 });
  },

  async joinCall(
    roomId: string,
    anonymous = false,
  ): Promise<ApiResponse<CallJoinResponse>> {
    const res = await callEdgeFunction<CallJoinResponse>("call_join", {
      roomId,
      anonymous,
    });
    if (!res.ok && res.error) {
      return {
        ...res,
        error: { ...res.error, message: callErrorMessage(res.error.message) },
      };
    }
    return res;
  },

  /**
   * Mark MY membership left. Call admission lives in video_room_members
   * (admit_call_participant) but nothing ever wrote 'left' — rows stayed
   * 'active' forever, so a call went call_full after four people had ever
   * joined and nobody could get back in. video_leave_room is room-kind
   * agnostic: marks the member left, decrements the count, and ends the
   * room itself when the host or the last participant walks out.
   */
  async leaveCall(
    roomId: string,
  ): Promise<ApiResponse<{ left: boolean; roomEnded: boolean }>> {
    return callEdgeFunction("video_leave_room", { roomId });
  },
};
