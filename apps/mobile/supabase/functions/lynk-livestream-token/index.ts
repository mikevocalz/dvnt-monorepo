/**
 * Edge Function: lynk-livestream-token
 *
 * Legacy Fishjam WHIP/WHEP transport for Lynk Live. Current native and web
 * clients use MoQ, but this retained endpoint must enforce the same authoritative
 * room admission before issuing any publish capability.
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
import { resolveEventRoomAccess } from "../_shared/event-access.ts";
import { verifySessionDetailed } from "../_shared/verify-session.ts";
import { resolveVerifiedAdmission, admissionRefusal } from "../_shared/verified-admission.ts";
import { creatorStandingRefusal, resolveCreatorStanding } from "../_shared/creator-standing.ts";
// PINNED — see lynk-moq-token for what a floating specifier cost us. The
// three calls below (createRoom / createLivestreamStreamerToken /
// createLivestreamViewerToken) all still exist in 0.30.0, so this one was
// working; it was one rename away from the same silent break.
import { FishjamClient } from "npm:@fishjam-cloud/js-server-sdk@0.30.0";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-auth-token, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const Schema = z.object({
  roomId: z.string().uuid(),
  intent: z.enum(["publish", "subscribe"]),
  // Same compatibility contract as video_join_room: a declared platform is not
  // device attestation; absent/unknown values keep older native clients working.
  platform: z.string().max(32).optional(),
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
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const fishjam = new FishjamClient({
      fishjamId: Deno.env.get("FISHJAM_APP_ID")!,
      managementToken: Deno.env.get("FISHJAM_API_KEY")!,
    });

    // 1. Session (shared helper)
    const sessionResult = await verifySessionDetailed(supabase, req);
    if (!sessionResult.ok) {
      if (sessionResult.reason === "missing")
        return err("unauthorized", "Missing session token");
      if (sessionResult.reason === "expired")
        return err("unauthorized", "Session expired");
      return err("unauthorized", "Invalid or expired session");
    }
    const userId = sessionResult.userId as string;

    // Verified-only admission. A client that skips the banner is still refused.
    const admission = await resolveVerifiedAdmission(supabase, userId);
    if (admission.state === "blocked") {
      const refusal = admissionRefusal(admission);
      return err("forbidden", refusal.message, { reason: refusal.reason });
    }

    // 2. Input
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return err("validation_error", "Invalid JSON body");
    }
    const parsed = Schema.safeParse(body);
    if (!parsed.success) return err("validation_error", parsed.error.issues[0]?.message ?? "Invalid token request");
    const { roomId, intent, platform } = parsed.data;

    async function authorizeAccess() {
      const admission = await resolveVerifiedAdmission(supabase, userId);
      if (admission.state === "blocked") {
        const refusal = admissionRefusal(admission);
        return err("forbidden", refusal.message, { reason: refusal.reason });
      }

      // 3. Room
      const { data: room, error: roomError } = await supabase
        .from("video_rooms")
        .select("*")
        .eq("uuid", roomId)
        .maybeSingle();
      if (roomError) throw roomError;
      if (!room) return err("not_found", "Room not found");
      if (room.status !== "open") return err("conflict", "Room is no longer open");
      if (room.room_kind !== "call" && room.app_only === true && platform === "web") {
        return err("forbidden", "This Lynk is app-only", { reason: "ROOM_APP_ONLY" });
      }
      // Every media transport enforces current admission and schedule before tokens.
      const eventAccess = await resolveEventRoomAccess(supabase, room, userId);
      if (!eventAccess.ok) {
        return err(eventAccess.code, eventAccess.message, eventAccess.detail);
      }
      room.ends_at = eventAccess.endsAt;
      if (room.ends_at && Date.parse(room.ends_at) <= Date.now()) {
        return err("conflict", "This Lynk's session has ended", { reason: "session_expired" });
      }

      const internalRoomId = room.id;

      // 4. Ban + membership
      const { data: isBanned, error: banError } = await supabase.rpc("is_user_banned_from_room", {
        p_user_id: userId,
        p_room_id: internalRoomId,
      });
      if (banError) throw banError;
      if (isBanned) return err("forbidden", "You are banned from this room");

      const { data: existingMember, error: memberError } = await supabase
        .from("video_room_members")
        .select("*")
        .eq("room_id", internalRoomId)
        .eq("user_id", userId)
        .maybeSingle();
      if (memberError) throw memberError;
      if (existingMember && (existingMember.user_id !== userId || existingMember.room_id !== internalRoomId)) {
        return err("forbidden", "Room membership could not be verified", { reason: "room_join_required" });
      }
      if (existingMember?.status === "kicked")
        return err("forbidden", "You have been removed from this room");
      if (existingMember?.status === "banned")
        return err("forbidden", "You are banned from this room");

      const isHostOrCoHost =
        userId === room.created_by ||
        existingMember?.role === "host" ||
        existingMember?.role === "co-host";

      if (room.room_kind !== "call" && isHostOrCoHost) {
        const standing = await resolveCreatorStanding(supabase, userId);
        if (standing.state === "refused") {
          const refusal = creatorStandingRefusal(standing);
          return err("forbidden", refusal.message, { reason: refusal.reason, code: refusal.code });
        }
      }

      // 5. Private gate (verbatim from video_join_room)
      if (!room.is_public && !eventAccess.linked) {
        const hasPriorAccess =
          !!existingMember &&
          existingMember.status !== "banned" &&
          existingMember.status !== "kicked";
        let hasInvite = false;
        if (!isHostOrCoHost && !hasPriorAccess) {
          const { data: invite, error: inviteError } = await supabase
            .from("video_room_invites")
            .select("id")
            .eq("room_id", internalRoomId)
            .eq("user_id", userId)
            .maybeSingle();
          if (inviteError) throw inviteError;
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

      if (intent === "publish") {
        if (existingMember?.status !== "active") {
          return err("forbidden", "Join this Lynk before broadcasting", { reason: "room_join_required" });
        }
        if (!PUBLISH_ROLES.has(role)) {
          return err("forbidden", "Not permitted to broadcast in this Lynk", {
            reason: "publish_not_allowed",
            role,
          });
        }
      }
      return { room, internalRoomId, existingMember, role, peerId: peerIdFor(userId, existingMember?.anon_label ?? null) };
    }

    const before = await authorizeAccess();
    if (before instanceof Response) return before;
    const { internalRoomId, existingMember } = before;

    // ── PUBLISH: provision media only for an already admitted member ─────────
    if (intent === "publish") {
      // This endpoint never inserts membership or reactivates a departed user.
      // video_join_room is the only admission path, including for the creator.
      let livestreamId: string | null = existingMember.livestream_id ?? null;
      if (!livestreamId) {
        const lsRoom = await fishjam.createRoom({ roomType: "livestream" });
        livestreamId = lsRoom.id;
        const { data: savedMember, error: saveError } = await supabase
          .from("video_room_members")
          .update({ livestream_id: livestreamId })
          .eq("room_id", internalRoomId)
          .eq("user_id", userId)
          .eq("status", "active")
          .select("livestream_id")
          .maybeSingle();
        if (saveError) throw saveError;
        if (!savedMember) return err("forbidden", "Your room membership has ended", { reason: "room_join_required" });
      }

      const { token } = await fishjam.createLivestreamStreamerToken(livestreamId);
      const after = await authorizeAccess();
      if (after instanceof Response) return after;
      if (after.internalRoomId !== internalRoomId || after.peerId !== before.peerId || after.existingMember?.livestream_id !== livestreamId) {
        return err("conflict", "Room access changed; rejoin this Lynk");
      }
      return json({
        ok: true,
        data: { intent, token, livestreamId, peerId: after.peerId, role: after.role },
      });
    }

    // ── SUBSCRIBE: a viewer token per ACTIVE publisher in the room ────────────
    async function activePublishers() {
      const { data, error } = await supabase
        .from("video_room_members")
        .select("user_id, role, anon_label, livestream_id")
        .eq("room_id", internalRoomId)
        .eq("status", "active")
        .not("livestream_id", "is", null)
        .in("role", ["host", "co-host", "speaker"]);
      if (error) throw error;
      return data ?? [];
    }
    const publishers = await activePublishers();
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

    const after = await authorizeAccess();
    if (after instanceof Response) return after;
    if (before.existingMember?.status === "active" && after.existingMember?.status !== "active") {
      return err("forbidden", "Your room membership has ended");
    }
    if (after.internalRoomId !== internalRoomId) {
      return err("conflict", "Room access changed; rejoin this Lynk");
    }
    // Do not release a viewer token for a publisher that left, was demoted or
    // changed stream identity while the provider was minting the batch.
    const currentPublishers = await activePublishers();
    const currentStreams = streams.filter((stream, index) => currentPublishers.some((publisher) =>
      publisher.user_id === publishers[index].user_id &&
      publisher.livestream_id === stream.livestreamId &&
      publisher.role === stream.role &&
      peerIdFor(publisher.user_id, publisher.anon_label ?? null) === stream.peerId
    ));
    return json({ ok: true, data: { intent, streams: currentStreams } });
  } catch (e) {
    console.error("[lynk-livestream-token] error:", e);
    return err("internal_error", "Failed to mint livestream token");
  }
});
