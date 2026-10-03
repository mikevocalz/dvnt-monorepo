/**
 * Edge Function: lynk-room-comment
 *
 *   { action: "post",   roomId, body, parentId?, mentions? }
 *   { action: "delete", roomId, commentId }
 *
 * The only write path for Sneaky Lynk room chat. Clients have no INSERT,
 * UPDATE or DELETE on public.room_comments and cannot read its author_id
 * (migration 20261003150300). A trigger sets author_handle from the author's
 * video_room_members row: their auth id when named, `member:<row id>` when
 * anonymous. Responses carry author_handle and never author_id.
 *
 * Posting needs an active membership row in an open room and no active ban.
 * Deleting needs to be the author, or a room moderator per
 * can_user_moderate_room (the same check video_kick_user and video_ban_user
 * use). Banning an author goes through video_ban_user with the message's
 * author_handle, which it resolves inside the room.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySessionDetailed } from "../_shared/verify-session.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import {
  CLIENT_COLUMNS,
  maskMentions,
  mayDeleteComment,
  parseRoomCommentRequest,
  threadPlacement,
  toClientComment,
} from "../_shared/room-comment.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-auth-token, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation_error"
  | "rate_limited"
  | "internal_error";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function errorResponse(code: ErrorCode, message: string): Response {
  console.error(`[Edge:lynk-room-comment] ${code} - ${message}`);
  return jsonResponse({ ok: false, error: { code, message } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("validation_error", "Method not allowed");
  }

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${serviceKey}` } },
    });

    const session = await verifySessionDetailed(supabase, req);
    if (!session.ok) {
      return errorResponse(
        "unauthorized",
        session.reason === "expired" ? "Session expired" : "Invalid or expired session",
      );
    }
    const actorId = session.userId;

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }
    const parsed = parseRoomCommentRequest(raw);
    if (!parsed.ok) return errorResponse("validation_error", parsed.message);
    const request = parsed.value;

    const { data: room } = await supabase
      .from("video_rooms")
      .select("id, uuid, status")
      .eq("uuid", request.roomId)
      .maybeSingle();
    if (!room) return errorResponse("not_found", "Room not found");
    const roomUuid = String(room.uuid);

    if (request.action === "delete") {
      const { data: comment } = await supabase
        .from("room_comments")
        .select("id, author_id")
        .eq("id", request.commentId)
        .eq("room_id", roomUuid)
        .maybeSingle();
      if (!comment) return errorResponse("not_found", "Message not found");

      let canModerate = false;
      if (comment.author_id !== actorId) {
        const { data } = await supabase.rpc("can_user_moderate_room", {
          p_user_id: actorId,
          p_room_id: room.id,
        });
        canModerate = data === true;
      }
      if (!mayDeleteComment({ actorId, authorId: comment.author_id, canModerate })) {
        return errorResponse("forbidden", "You cannot delete this message");
      }

      const { error } = await supabase
        .from("room_comments")
        .delete()
        .eq("id", request.commentId)
        .eq("room_id", roomUuid);
      if (error) {
        console.error("[Edge:lynk-room-comment] delete failed:", error.message);
        return errorResponse("internal_error", "Could not delete the message");
      }
      return jsonResponse({ ok: true, data: { deleted: true, commentId: request.commentId } });
    }

    // ── post ────────────────────────────────────────────────────────────────
    if (room.status !== "open") {
      return errorResponse("conflict", "Room is no longer open");
    }

    const rl = checkRateLimit(actorId, "lynk-room-comment", {
      maxRequests: 30,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return errorResponse("rate_limited", "Too many messages. Slow down.");
    }

    const { data: member } = await supabase
      .from("video_room_members")
      .select("id, status")
      .eq("room_id", room.id)
      .eq("user_id", actorId)
      .maybeSingle();
    if (!member || member.status !== "active") {
      return errorResponse("forbidden", "Join the room to chat");
    }

    const { data: isBanned } = await supabase.rpc("is_user_banned_from_room", {
      p_user_id: actorId,
      p_room_id: room.id,
    });
    if (isBanned) return errorResponse("forbidden", "You are banned from this room");

    let parent: { id: number; root_id: number | null; depth: number } | null = null;
    if (request.parentId !== null) {
      const { data } = await supabase
        .from("room_comments")
        .select("id, root_id, depth")
        .eq("id", request.parentId)
        .eq("room_id", roomUuid)
        .maybeSingle();
      if (!data) return errorResponse("validation_error", "Reply target not found");
      parent = data;
    }

    let mentions = request.mentions;
    if (mentions.length > 0) {
      const { data: anonymous } = await supabase
        .from("video_room_members")
        .select("id, user_id")
        .eq("room_id", room.id)
        .eq("is_anonymous", true)
        .in("user_id", mentions.map((m) => m.userId));
      mentions = maskMentions(mentions, anonymous ?? []);
    }

    const { data: inserted, error } = await supabase
      .from("room_comments")
      .insert({
        room_id: roomUuid,
        author_id: actorId,
        body: request.body,
        ...threadPlacement(parent),
        mentions,
      })
      .select(CLIENT_COLUMNS)
      .single();
    if (error || !inserted) {
      console.error("[Edge:lynk-room-comment] insert failed:", error?.message);
      return errorResponse("internal_error", "Could not send the message");
    }

    return jsonResponse({ ok: true, data: { comment: toClientComment(inserted) } });
  } catch (err) {
    console.error("[Edge:lynk-room-comment] unexpected:", err);
    return errorResponse("internal_error", "Unexpected error");
  }
});
