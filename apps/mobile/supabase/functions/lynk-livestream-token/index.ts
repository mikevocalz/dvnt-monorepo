/**
 * Edge Function: lynk-livestream-token
 *
 * NATIVE transport for Lynk Live (host/cohost/speaker publish → many viewers) via
 * Fishjam WHIP/WHEP livestream. The web path uses MoQ (`lynk-moq-token`); native
 * uses this because `@moq/*` has no React-Native client, whereas
 * `@fishjam-cloud/react-native-client` ships first-party `useLivestreamStreamer`/
 * `useLivestreamViewer` that render a real native `MediaStream` in `RTCView`.
 *
 * A Fishjam livestream room is ONE streamer → many viewers, so multi-speaker =
 * one livestream room per publisher (stored on `video_room_members.livestream_id`,
 * create-once). Viewers get a viewer token per active publisher and render one
 * tile each.
 *
 * Reuses the SAME Better-Auth session check + private-room gate as
 * `video_join_room` / `lynk-moq-token`. Management token stays server-side.
 *
 *   intent: "publish"   → ensures THIS user's livestream room + streamer token.
 *   intent: "subscribe" → viewer token for EACH active publisher in the room.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { FishjamClient } from "npm:@fishjam-cloud/js-server-sdk";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-auth-token",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const Schema = z.object({
  roomId: z.string().uuid(),
  intent: z.enum(["publish", "subscribe"]),
});

type ErrorCode =
  | "unauthorized"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "validation_error"
  | "internal_error";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
function err(code: ErrorCode, message: string, detail?: Record<string, unknown>) {
  return json({ ok: false, error: { code, message, ...(detail ? { detail } : {}) } });
}

const PUBLISH_ROLES = new Set(["host", "co-host", "speaker"]);

function peerIdFor(userId: string, anonLabel: string | null): string {
  if (anonLabel) return `anon-${anonLabel.match(/(\d+)/)?.[1] ?? "0"}`;
  return userId.replace(/[^a-zA-Z0-9_-]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") return err("validation_error", "Method not allowed");

  try {
    const jwt = (
      req.headers.get("x-auth-token") ||
      req.headers.get("Authorization")?.replace("Bearer ", "") ||
      ""
    ).trim();
    if (!jwt) return err("unauthorized", "Missing session token");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const fishjam = new FishjamClient({
      fishjamId: Deno.env.get("FISHJAM_APP_ID")!,
      managementToken: Deno.env.get("FISHJAM_API_KEY")!,
    });

    // 1. Session
    const { data: session } = await supabase
      .from("session")
      .select("userId, expiresAt")
      .eq("token", jwt)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (!session) return err("unauthorized", "Invalid or expired session");
    if (new Date(session.expiresAt) < new Date())
      return err("unauthorized", "Session expired");
    const userId = session.userId as string;

    // 2. Input
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return err("validation_error", "Invalid JSON body");
    }
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return err("validation_error", parsed.error.errors[0].message);
    const { roomId, intent } = parsed.data;

    // 3. Room
    const { data: room } = await supabase
      .from("video_rooms")
      .select("*")
      .eq("uuid", roomId)
      .single();
    if (!room) return err("not_found", "Room not found");
    if (room.status !== "open") return err("conflict", "Room is no longer open");
    const internalRoomId = room.id;

    // 4. Ban + membership
    const { data: isBanned } = await supabase.rpc("is_user_banned_from_room", {
      p_user_id: userId,
      p_room_id: internalRoomId,
    });
    if (isBanned) return err("forbidden", "You are banned from this room");

    const { data: existingMember } = await supabase
      .from("video_room_members")
      .select("*")
      .eq("room_id", internalRoomId)
      .eq("user_id", userId)
      .maybeSingle();
    if (existingMember?.status === "banned")
      return err("forbidden", "You are banned from this room");

    const isHostOrCoHost =
      userId === room.created_by ||
      existingMember?.role === "host" ||
      existingMember?.role === "co-host";

    // 5. Private gate (verbatim from video_join_room)
    if (!room.is_public) {
      const hasPriorAccess =
        !!existingMember &&
        existingMember.status !== "banned" &&
        existingMember.status !== "kicked";
      let hasInvite = false;
      if (!isHostOrCoHost && !hasPriorAccess) {
        const { data: invite } = await supabase
          .from("video_room_invites")
          .select("id")
          .eq("room_id", internalRoomId)
          .eq("user_id", userId)
          .maybeSingle();
        hasInvite = !!invite;
      }
      if (!isHostOrCoHost && !hasPriorAccess && !hasInvite)
        return err("forbidden", "This private Lynk is invite-only", {
          reason: "invite_only",
        });
    }

    const role = isHostOrCoHost
      ? userId === room.created_by
        ? "host"
        : existingMember?.role ?? "co-host"
      : existingMember?.role ?? "participant";

    // ── PUBLISH: ensure this user's livestream room + streamer token ──────────
    if (intent === "publish") {
      if (role !== "host" && !PUBLISH_ROLES.has(role))
        return err("forbidden", "Not permitted to broadcast in this Lynk", {
          reason: "publish_not_allowed",
          role,
        });

      const peerId = peerIdFor(userId, existingMember?.anon_label ?? null);

      // Ensure a membership row exists (host may publish before joining).
      if (!existingMember) {
        await supabase.from("video_room_members").insert({
          room_id: internalRoomId,
          user_id: userId,
          role,
          status: "active",
        });
      }

      // Create-once livestream room; reuse the stored id across reconnects.
      let livestreamId: string | null = existingMember?.livestream_id ?? null;
      if (!livestreamId) {
        const lsRoom = await fishjam.createRoom({ roomType: "livestream" });
        livestreamId = lsRoom.id;
        await supabase
          .from("video_room_members")
          .update({ livestream_id: livestreamId, status: "active" })
          .eq("room_id", internalRoomId)
          .eq("user_id", userId);
      }

      const { token } = await fishjam.createLivestreamStreamerToken(livestreamId);
      return json({
        ok: true,
        data: { intent, token, livestreamId, peerId, role },
      });
    }

    // ── SUBSCRIBE: a viewer token per ACTIVE publisher in the room ────────────
    const { data: publishers } = await supabase
      .from("video_room_members")
      .select("user_id, role, anon_label, livestream_id")
      .eq("room_id", internalRoomId)
      .eq("status", "active")
      .not("livestream_id", "is", null)
      .in("role", ["host", "co-host", "speaker"]);

    const streams = await Promise.all(
      (publishers ?? []).map(async (p) => {
        const { token } = await fishjam.createLivestreamViewerToken(p.livestream_id);
        return {
          peerId: peerIdFor(p.user_id, p.anon_label ?? null),
          role: p.role,
          livestreamId: p.livestream_id as string,
          token,
        };
      }),
    );

    return json({ ok: true, data: { intent, streams } });
  } catch (e) {
    console.error("[lynk-livestream-token] error:", e);
    return err("internal_error", "Failed to mint livestream token");
  }
});
