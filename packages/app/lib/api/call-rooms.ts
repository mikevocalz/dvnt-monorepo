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
  functionName: "call_create" | "call_join",
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
    return callEdgeFunction<CallCreateResponse>("call_create", params);
  },

  async joinCall(
    roomId: string,
    anonymous = false,
  ): Promise<ApiResponse<CallJoinResponse>> {
    return callEdgeFunction<CallJoinResponse>("call_join", { roomId, anonymous });
  },
};
