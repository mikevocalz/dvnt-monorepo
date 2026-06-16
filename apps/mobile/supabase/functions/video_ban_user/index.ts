/**
 * Edge Function: video_ban_user
 * Bans a user from a video room (persistent removal)
 * Revokes tokens, updates membership, and broadcasts eject event
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const BanUserSchema = z.object({
  roomId: z.string().uuid(),
  targetUserId: z.string().min(1),
  reason: z.string().max(500).optional(),
  durationMinutes: z.number().int().min(1).max(525600).optional(), // Max 1 year, null = permanent
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

    const parsed = BanUserSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse(
        "validation_error",
        parsed.error.errors[0].message,
        400,
      );
    }

    const { roomId, targetUserId, reason, durationMinutes } = parsed.data;

    // Cannot ban yourself
    if (actorId === targetUserId) {
      return errorResponse("validation_error", "Cannot ban yourself");
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

    // Check actor has permission to ban
    const { data: canModerate } = await supabase.rpc("can_user_moderate_room", {
      p_user_id: actorId,
      p_room_id: internalRoomId,
    });

    if (!canModerate) {
      return errorResponse(
        "forbidden",
        "You do not have permission to ban users",
        403,
      );
    }

    // Check target's role
    const { data: targetRole } = await supabase.rpc("get_user_room_role", {
      p_user_id: targetUserId,
      p_room_id: internalRoomId,
    });

    // Cannot ban the host
    if (targetRole === "host") {
      return errorResponse("forbidden", "Cannot ban the room host");
    }

    // Get actor's role to check hierarchy
    const { data: actorRole } = await supabase.rpc("get_user_room_role", {
      p_user_id: actorId,
      p_room_id: internalRoomId,
    });

    // Moderators cannot ban other moderators
    if (actorRole === "moderator" && targetRole === "moderator") {
      return errorResponse(
        "forbidden",
        "Moderators cannot ban other moderators",
        403,
      );
    }

    // Calculate expiry
    const expiresAt = durationMinutes
      ? new Date(Date.now() + durationMinutes * 60 * 1000).toISOString()
      : null;

    // 1. Create or update ban record
    const { error: banError } = await supabase.from("video_room_bans").upsert(
      {
        room_id: internalRoomId,
        user_id: targetUserId,
        banned_by: actorId,
        reason,
        expires_at: expiresAt,
        created_at: new Date().toISOString(),
      },
      {
        onConflict: "room_id,user_id",
      },
    );

    if (banError) {
      console.error("[video_ban_user] Ban insert error:", banError.message);
      return errorResponse("internal_error", "Failed to ban user");
    }

    // 2. Update member status to banned
    const { error: updateError } = await supabase
      .from("video_room_members")
      .update({
        status: "banned",
        left_at: new Date().toISOString(),
        hand_raised: false,
      })
      .eq("room_id", internalRoomId)
      .eq("user_id", targetUserId);

    if (updateError) {
      console.error(
        "[video_ban_user] Member update error:",
        updateError.message,
      );
    }

    // 3. Revoke all active tokens
    await supabase
      .from("video_room_tokens")
      .update({ revoked_at: new Date().toISOString() })
      .eq("room_id", internalRoomId)
      .eq("user_id", targetUserId)
      .is("revoked_at", null);

    // 4. Remove peer from Fishjam room
    if (room.fishjam_room_id) {
      try {
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
        console.error("[video_ban_user] Fishjam peer removal error:", err);
      }
    }

    // 5. Insert eject event (triggers realtime broadcast)
    await supabase.from("video_room_events").insert({
      room_id: internalRoomId,
      type: "eject",
      actor_id: actorId,
      target_id: targetUserId,
      payload: { action: "ban", reason, expiresAt },
    });

    // Also insert member_banned for audit
    await supabase.from("video_room_events").insert({
      room_id: internalRoomId,
      type: "member_banned",
      actor_id: actorId,
      target_id: targetUserId,
      payload: { reason, expiresAt },
    });

    console.log(
      `[video_ban_user] User ${targetUserId} banned from room ${roomId} by ${actorId}`,
    );

    return jsonResponse({
      ok: true,
      data: {
        banned: true,
        targetUserId,
        roomId,
        expiresAt,
      },
    });
  } catch (err) {
    console.error("[video_ban_user] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
