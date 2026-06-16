/**
 * Edge Function: video_change_role
 * Host can promote/demote users (co-host, participant)
 * Broadcasts role_changed event via Supabase realtime
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ChangeRoleSchema = z.object({
  roomId: z.string().uuid(),
  targetUserId: z.string().min(1),
  newRole: z.enum(["co-host", "participant"]),
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
      return errorResponse("unauthorized", "Missing or invalid Authorization header");
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

    const parsed = ChangeRoleSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("validation_error", parsed.error.errors[0].message);
    }

    const { roomId, targetUserId, newRole } = parsed.data;

    // Cannot change your own role
    if (actorId === targetUserId) {
      return errorResponse("validation_error", "Cannot change your own role");
    }

    // Check room exists and is open
    const { data: room, error: roomError } = await supabase
      .from("video_rooms")
      .select("*")
      .eq("uuid", roomId)
      .single();

    if (roomError || !room) {
      return errorResponse("not_found", "Room not found");
    }

    const internalRoomId = room.id;

    if (room.status !== "open") {
      return errorResponse("conflict", "Room is no longer open");
    }

    // Only host can change roles
    const { data: actorRole } = await supabase.rpc("get_user_room_role", {
      p_user_id: actorId,
      p_room_id: internalRoomId,
    });

    if (actorRole !== "host") {
      return errorResponse("forbidden", "Only the host can change roles");
    }

    // Check target is active member
    const { data: targetMember } = await supabase
      .from("video_room_members")
      .select("*")
      .eq("room_id", internalRoomId)
      .eq("user_id", targetUserId)
      .eq("status", "active")
      .single();

    if (!targetMember) {
      return errorResponse("not_found", "User is not an active member of this room");
    }

    // Cannot change host's role
    if (targetMember.role === "host") {
      return errorResponse("forbidden", "Cannot change the host's role");
    }

    // Skip if already the desired role
    if (targetMember.role === newRole) {
      return jsonResponse({
        ok: true,
        data: { changed: false, role: newRole, message: "User already has this role" },
      });
    }

    // Update role
    const { error: updateError } = await supabase
      .from("video_room_members")
      .update({ role: newRole })
      .eq("room_id", internalRoomId)
      .eq("user_id", targetUserId);

    if (updateError) {
      console.error("[video_change_role] Update error:", updateError.message);
      return errorResponse("internal_error", "Failed to change role");
    }

    // Broadcast role_changed event
    await supabase.from("video_room_events").insert({
      room_id: internalRoomId,
      type: "role_changed",
      actor_id: actorId,
      target_id: targetUserId,
      payload: { oldRole: targetMember.role, newRole },
    });

    console.log(
      `[video_change_role] ${targetUserId} role changed to ${newRole} in room ${roomId} by ${actorId}`,
    );

    return jsonResponse({
      ok: true,
      data: { changed: true, targetUserId, role: newRole },
    });
  } catch (err) {
    console.error("[video_change_role] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
