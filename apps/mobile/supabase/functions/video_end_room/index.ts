/**
 * Edge Function: video_end_room
 * Ends a video room (host only)
 * Removes all peers from Fishjam, broadcasts room_ended event
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const EndRoomSchema = z.object({
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
        401,
      );
    }

    const jwt = authHeader.replace("Bearer ", "");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const fishjamAppId = Deno.env.get("FISHJAM_APP_ID")!;
    const fishjamApiKey = Deno.env.get("FISHJAM_API_KEY")!;
    const fishjamBaseUrl = `https://fishjam.io/api/v1/connect/${fishjamAppId}`;

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

    const actorAuthId = session.userId;

    // Get the user's integer ID for room membership checks
    const { data: userData, error: userError } = await supabase
      .from("users")
      .select("id")
      .eq("auth_id", actorAuthId)
      .single();

    if (userError || !userData) {
      return errorResponse("not_found", "User not found");
    }

    const actorId = actorAuthId;

    // Parse input
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const parsed = EndRoomSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        "validation_error",
        parsed.error.errors[0].message,
        400,
      );
    }

    const { roomId } = parsed.data;

    // Check room exists — look up by uuid (what video_create_room returns)
    const { data: room, error: roomError } = await supabase
      .from("video_rooms")
      .select("*")
      .eq("uuid", roomId)
      .single();

    if (roomError || !room) {
      return errorResponse("not_found", "Room not found");
    }

    const internalRoomId = room.id;

    if (room.status === "ended") {
      return errorResponse("conflict", "Room is already ended");
    }

    // Only host can end room
    const { data: actorRole } = await supabase.rpc("get_user_room_role", {
      p_user_id: actorId,
      p_room_id: internalRoomId,
    });

    if (actorRole !== "host") {
      return errorResponse("forbidden", "Only the host can end the room");
    }

    // 1. Delete Fishjam room (removes all peers)
    if (room.fishjam_room_id) {
      try {
        await fetch(`${fishjamBaseUrl}/room/${room.fishjam_room_id}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${fishjamApiKey}` },
        });
      } catch (err) {
        console.error("[video_end_room] Fishjam room deletion error:", err);
      }
    }

    // 2. Update room status + reset participant count
    const { error: updateError } = await supabase
      .from("video_rooms")
      .update({
        status: "ended",
        ended_at: new Date().toISOString(),
        participant_count: 0,
      })
      .eq("id", internalRoomId);

    if (updateError) {
      console.error("[video_end_room] Room update error:", updateError.message);
      return errorResponse("internal_error", "Failed to end room");
    }

    // 3. Update all active members to 'left'
    await supabase
      .from("video_room_members")
      .update({
        status: "left",
        left_at: new Date().toISOString(),
        hand_raised: false,
      })
      .eq("room_id", internalRoomId)
      .eq("status", "active");

    // 4. Revoke all active tokens
    await supabase
      .from("video_room_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("room_id", internalRoomId)
      .is("revoked_at", null);

    // 5. Insert room_ended event (triggers realtime broadcast)
    await supabase.from("video_room_events").insert({
      room_id: internalRoomId,
      type: "room_ended",
      actor_id: actorId,
      payload: { endedAt: new Date().toISOString() },
    });

    console.log(`[video_end_room] Room ${roomId} ended by ${actorId}`);

    return jsonResponse({
      ok: true,
      data: {
        ended: true,
        roomId,
      },
    });
  } catch (err) {
    console.error("[video_end_room] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
