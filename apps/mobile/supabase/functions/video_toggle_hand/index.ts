/**
 * Edge Function: video_toggle_hand
 * Toggles the caller's raised-hand state inside an active Sneaky Lynk room.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ToggleHandSchema = z.object({
  roomId: z.string().uuid(),
  raised: z.boolean(),
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

    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const parsed = ToggleHandSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("validation_error", parsed.error.errors[0].message);
    }

    const { roomId, raised } = parsed.data;

    const { data: room, error: roomError } = await supabase
      .from("video_rooms")
      .select("id, uuid, status")
      .eq("uuid", roomId)
      .single();

    if (roomError || !room) {
      return errorResponse("not_found", "Room not found");
    }

    if (room.status !== "open") {
      return errorResponse("conflict", "Room is no longer open");
    }

    const { data: member, error: memberError } = await supabase
      .from("video_room_members")
      .select("status, hand_raised")
      .eq("room_id", room.id)
      .eq("user_id", actorId)
      .single();

    if (memberError || !member || member.status !== "active") {
      return errorResponse(
        "forbidden",
        "You are not an active member of this room",
      );
    }

    if (!!member.hand_raised === raised) {
      return jsonResponse({
        ok: true,
        data: {
          roomId: room.uuid || roomId,
          raised,
        },
      });
    }

    const { error: updateError } = await supabase
      .from("video_room_members")
      .update({ hand_raised: raised })
      .eq("room_id", room.id)
      .eq("user_id", actorId)
      .eq("status", "active");

    if (updateError) {
      console.error(
        "[video_toggle_hand] Member update error:",
        updateError.message,
      );
      return errorResponse("internal_error", "Failed to update hand state");
    }

    await supabase.from("video_room_events").insert({
      room_id: room.id,
      type: raised ? "hand_raised" : "hand_lowered",
      actor_id: actorId,
      payload: { raised },
    });

    return jsonResponse({
      ok: true,
      data: {
        roomId: room.uuid || roomId,
        raised,
      },
    });
  } catch (err) {
    console.error("[video_toggle_hand] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
