/**
 * Edge Function: video_kick_user
 * Kicks a user from a video room (temporary removal)
 * Revokes tokens and broadcasts eject event
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const KickUserSchema = z.object({
  roomId: z.string().uuid(),
  targetUserId: z.string().min(1),
  reason: z.string().max(500).optional(),
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

    const supabase = createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } } });

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

    const actorId = session.userId;

    // Parse input
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const parsed = KickUserSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        "validation_error",
        parsed.error.errors[0].message,
        400,
      );
    }

    const { roomId, targetUserId, reason } = parsed.data;

    // Cannot kick yourself
    if (actorId === targetUserId) {
      return errorResponse("validation_error", "Cannot kick yourself");
    }

    // Check room exists and is open — look up by uuid
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

    // Check actor has permission to kick
    const { data: canModerate } = await supabase.rpc("can_user_moderate_room", {
      p_user_id: actorId,
      p_room_id: internalRoomId,
    });

    if (!canModerate) {
      return errorResponse(
        "forbidden",
        "You do not have permission to kick users",
        403,
      );
    }

    // Check target is a member
    const { data: targetMember } = await supabase
      .from("video_room_members")
      .select("*")
      .eq("room_id", internalRoomId)
      .eq("user_id", targetUserId)
      .single();

    if (!targetMember || targetMember.status !== "active") {
      return errorResponse(
        "not_found",
        "User is not an active member of this room",
        404,
      );
    }

    // Cannot kick the host
    if (targetMember.role === "host") {
      return errorResponse("forbidden", "Cannot kick the room host");
    }

    // Get actor's role to check hierarchy
    const { data: actorRole } = await supabase.rpc("get_user_room_role", {
      p_user_id: actorId,
      p_room_id: internalRoomId,
    });

    // Moderators cannot kick other moderators
    if (actorRole === "moderator" && targetMember.role === "moderator") {
      return errorResponse(
        "forbidden",
        "Moderators cannot kick other moderators",
        403,
      );
    }

    // 1. Update member status to kicked
    const { error: updateError } = await supabase
      .from("video_room_members")
      .update({
        status: "kicked",
        left_at: new Date().toISOString(),
        hand_raised: false,
      })
      .eq("room_id", internalRoomId)
      .eq("user_id", targetUserId);

    if (updateError) {
      console.error("[video_kick_user] Update error:", updateError.message);
      return errorResponse("internal_error", "Failed to kick user");
    }

    // 2. Revoke all active tokens for this user in this room
    const { error: revokeError } = await supabase
      .from("video_room_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("room_id", internalRoomId)
      .eq("user_id", targetUserId)
      .is("revoked_at", null);

    if (revokeError) {
      console.error(
        "[video_kick_user] Token revocation error:",
        revokeError.message,
      );
    }

    // 3. Record kick in audit table
    await supabase.from("video_room_kicks").insert({
      room_id: internalRoomId,
      user_id: targetUserId,
      kicked_by: actorId,
      reason,
    });

    // 4. Remove peer from Fishjam room
    if (room.fishjam_room_id) {
      try {
        // Get all peers and find the one with matching userId
        const peersRes = await fetch(
          `${fishjamBaseUrl}/room/${room.fishjam_room_id}`,
          {
            headers: { Authorization: `Bearer ${fishjamApiKey}` },
          },
        );

        if (peersRes.ok) {
          const roomData = await peersRes.json();
          const peers = roomData.data.room.peers || [];
          const targetPeer = peers.find(
            (p: any) => p.metadata?.userId === targetUserId,
          );

          if (targetPeer) {
            await fetch(
              `${fishjamBaseUrl}/room/${room.fishjam_room_id}/peer/${targetPeer.id}`,
              {
                method: "DELETE",
                headers: { Authorization: `Bearer ${fishjamApiKey}` },
              },
            );
          }
        }
      } catch (err) {
        console.error("[video_kick_user] Fishjam peer removal error:", err);
      }
    }

    // 5. Insert eject event (this triggers realtime broadcast)
    const { error: eventError } = await supabase
      .from("video_room_events")
      .insert({
        room_id: internalRoomId,
        type: "eject",
        actor_id: actorId,
        target_id: targetUserId,
        payload: { action: "kick", reason },
      });

    if (eventError) {
      console.error(
        "[video_kick_user] Event insert error:",
        eventError.message,
      );
    }

    // Also insert member_kicked for audit
    await supabase.from("video_room_events").insert({
      room_id: internalRoomId,
      type: "member_kicked",
      actor_id: actorId,
      target_id: targetUserId,
      payload: { reason },
    });

    console.log(
      `[video_kick_user] User ${targetUserId} kicked from room ${roomId} by ${actorId}`,
    );

    return jsonResponse({
      ok: true,
      data: {
        kicked: true,
        targetUserId,
        roomId,
      },
    });
  } catch (err) {
    console.error("[video_kick_user] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
