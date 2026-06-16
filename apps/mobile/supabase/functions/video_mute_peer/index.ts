/**
 * Edge Function: video_mute_peer
 * Host/co-host can request a participant to be muted.
 * Broadcasts a "mute_peer" event via Supabase realtime —
 * the target client listens for this and disables their mic.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const MutePeerSchema = z.object({
  roomId: z.string().uuid(),
  targetUserId: z.string().min(1),
  action: z.enum(["mute", "unmute"]).optional().default("mute"),
});

type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation_error"
  | "internal_error";

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: ErrorCode; message: string };
}

function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(code: ErrorCode, message: string): Response {
  return jsonResponse({ ok: false, error: { code, message } }, 200);
}

Deno.serve(async (req: any) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("validation_error", "Method not allowed");
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse(
        "unauthorized",
        "Missing or invalid Authorization header",
      );
    }

    const jwt = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // Verify session
    const { data: session, error: sessionError } = await supabase
      .from("session")
      .select("id, token, userId, expiresAt")
      .eq("token", jwt)
      .single();

    if (sessionError || !session) {
      return errorResponse("unauthorized", "Invalid or expired session");
    }
    if (new Date(session.expiresAt) < new Date()) {
      return errorResponse("unauthorized", "Session expired");
    }

    const actorId = session.userId;

    // Parse input
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const parsed = MutePeerSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("validation_error", parsed.error.errors[0].message);
    }

    const { roomId, targetUserId, action } = parsed.data;
    const eventType = action === "unmute" ? "unmute_peer" : "mute_peer";

    // Cannot mute yourself via this endpoint
    if (actorId === targetUserId) {
      return errorResponse(
        "validation_error",
        "Use local controls to mute yourself",
      );
    }

    // Check room exists and is open
    const { data: room, error: roomError } = await supabase
      .from("video_rooms")
      .select("id, status")
      .eq("uuid", roomId)
      .single();

    if (roomError || !room) {
      return errorResponse("not_found", "Room not found");
    }

    const internalRoomId = room.id;

    if (room.status !== "open") {
      return errorResponse("conflict", "Room is no longer open");
    }

    // Check actor can moderate
    const { data: canModerate } = await supabase.rpc("can_user_moderate_room", {
      p_user_id: actorId,
      p_room_id: internalRoomId,
    });

    if (!canModerate) {
      return errorResponse(
        "forbidden",
        "You do not have permission to mute users",
      );
    }

    // Check target is active
    const { data: targetMember } = await supabase
      .from("video_room_members")
      .select("role, status")
      .eq("room_id", internalRoomId)
      .eq("user_id", targetUserId)
      .eq("status", "active")
      .single();

    if (!targetMember) {
      return errorResponse(
        "not_found",
        "User is not an active member of this room",
      );
    }

    // Cannot mute the host
    if (targetMember.role === "host") {
      return errorResponse("forbidden", "Cannot mute the room host");
    }

    // Broadcast mute/unmute event — client listens for this
    const { error: eventError } = await supabase
      .from("video_room_events")
      .insert({
        room_id: internalRoomId,
        type: eventType,
        actor_id: actorId,
        target_id: targetUserId,
        payload: {},
      });

    if (eventError) {
      console.error(
        `[video_mute_peer] Event error (${eventType}):`,
        eventError.message,
      );
      return errorResponse("internal_error", `Failed to send ${action} event`);
    }

    console.log(
      `[video_mute_peer] ${targetUserId} ${action}d in room ${roomId} by ${actorId}`,
    );

    return jsonResponse({
      ok: true,
      data: { [action === "unmute" ? "unmuted" : "muted"]: true, targetUserId },
    });
  } catch (err) {
    console.error("[video_mute_peer] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
