/**
 * Edge Function: video_leave_room
 * Marks a user as "left" in a video room, decrements participant_count,
 * and auto-ends the room if no active participants remain.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const LeaveRoomSchema = z.object({
  roomId: z.string().uuid(),
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

Deno.serve(async (req) => {
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

    // Verify Better Auth session via direct DB lookup
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

    const userId = session.userId;

    // Parse input
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const parsed = LeaveRoomSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        "validation_error",
        parsed.error.errors[0].message,
      );
    }

    const { roomId } = parsed.data;

    // Look up room by uuid
    const { data: room, error: roomError } = await supabase
      .from("video_rooms")
      .select("id, status, fishjam_room_id")
      .eq("uuid", roomId)
      .single();

    if (roomError || !room) {
      return errorResponse("not_found", "Room not found");
    }

    if (room.status === "ended") {
      // Room already ended — nothing to do
      return jsonResponse({ ok: true, data: { left: true, roomEnded: true } });
    }

    const internalRoomId = room.id;

    // Mark this user's membership as "left"
    const { error: leaveError } = await supabase
      .from("video_room_members")
      .update({
        status: "left",
        left_at: new Date().toISOString(),
        hand_raised: false,
      })
      .eq("room_id", internalRoomId)
      .eq("user_id", userId)
      .eq("status", "active");

    if (leaveError) {
      console.error(
        "[video_leave_room] Member update error:",
        leaveError.message,
      );
    }

    // Recompute participant_count from actual active members
    const { data: activeCount } = await supabase.rpc(
      "count_active_participants",
      { p_room_id: internalRoomId },
    );

    const newCount = activeCount ?? 0;

    // Update participant_count
    await supabase
      .from("video_rooms")
      .update({ participant_count: newCount })
      .eq("id", internalRoomId);

    // Insert member_left event
    await supabase.from("video_room_events").insert({
      room_id: internalRoomId,
      type: "member_left",
      actor_id: userId,
      payload: { remainingParticipants: newCount },
    });

    // Revoke this user's active tokens
    await supabase
      .from("video_room_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("room_id", internalRoomId)
      .eq("user_id", userId)
      .is("revoked_at", null);

    // Auto-end the room if no active participants remain
    let roomEnded = false;
    if (newCount === 0) {
      const { error: endError } = await supabase
        .from("video_rooms")
        .update({
          status: "ended",
          ended_at: new Date().toISOString(),
          participant_count: 0,
        })
        .eq("id", internalRoomId)
        .eq("status", "open"); // CAS guard

      if (!endError) {
        roomEnded = true;

        // Insert room_ended event
        await supabase.from("video_room_events").insert({
          room_id: internalRoomId,
          type: "room_ended",
          actor_id: userId,
          payload: { reason: "all_participants_left" },
        });

        console.log(
          `[video_leave_room] Room ${roomId} auto-ended (no participants)`,
        );
      }
    }

    console.log(
      `[video_leave_room] User ${userId} left room ${roomId} (remaining: ${newCount})`,
    );

    return jsonResponse({
      ok: true,
      data: { left: true, roomEnded, remainingParticipants: newCount },
    });
  } catch (err) {
    console.error("[video_leave_room] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
