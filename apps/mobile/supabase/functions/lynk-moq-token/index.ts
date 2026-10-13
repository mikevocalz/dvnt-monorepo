/**
 * Edge Function: lynk-moq-token
 *
 * Mints a PATH-SCOPED, SINGLE-PURPOSE Media-over-QUIC (MoQ) token for Sneaky
 * Lynk live rooms (the "Lynk Live" broadcast). This is the MoQ analogue of
 * `video_join_room` — it reuses the EXACT same Better-Auth session verification
 * and private-room authorization gate (host / co-host / prior member / invite /
 * public), then mints a Fishjam MoQ token via `@fishjam-cloud/js-server-sdk`
 * `createMoqAccess({ publishPath | subscribePath })` instead of a WebRTC peer
 * token.
 *
 * Roles → paths (multi-speaker model — DECIDED in docs/lynk-moq-fit.md §5.2):
 *   - publish intent → publishPath `lynk/${roomId}/${peerId}` (SPECIFIC path, so
 *     a publisher can only publish AS ITSELF). Authorized only for publish-capable
 *     roles: host / co-host / speaker.
 *   - subscribe intent → subscribePath `lynk/${roomId}` (BROAD namespace, so the
 *     viewer's `connection.announced` discovers every live publisher and mounts
 *     one tile per path with no reload). Authorized for any permitted member.
 *
 * A token is single-purpose: a subscribe token can NEVER publish (enforced
 * server-side by which field we pass to createMoqAccess). A broadcaster requests
 * BOTH a publish token (own path) and a subscribe token (namespace) — two calls.
 *
 * Management token (`FISHJAM_API_KEY`) NEVER leaves the server; the client only
 * receives the scoped MoQ token + the public `FISHJAM_APP_ID` + the relay URL.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveEventRoomAccess } from "../_shared/event-access.ts";
import { verifySessionDetailed } from "../_shared/verify-session.ts";
import { resolveVerifiedAdmission, admissionRefusal } from "../_shared/verified-admission.ts";
import { mintBoundedMoqAccess, moqAccessFailure } from "../_shared/lynk-moq-access.ts";
// PINNED. This import used to be bare `npm:@fishjam-cloud/js-server-sdk`, so
// Deno resolved whatever was latest at deploy time. 0.30.0 renamed
// `createMoqToken` to `createMoqAccess`, the call below started throwing
// TypeError, and every MoQ join — web AND native, product AND genesis — came
// back as `internal_error: Failed to mint MoQ token`. A silent server-side
// break with no client change is exactly what a floating range buys you.
// 0.30.1 adds the provider-signed TTL field (seconds). Keep this pinned.
import { FishjamClient } from "npm:@fishjam-cloud/js-server-sdk@0.30.1";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-auth-token, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TokenSchema = z.object({
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

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: ErrorCode; message: string; detail?: Record<string, unknown> };
}

function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(
  code: ErrorCode,
  message: string,
  detail?: Record<string, unknown>,
): Response {
  return jsonResponse(
    { ok: false, error: { code, message, ...(detail ? { detail } : {}) } },
    200,
  );
}

/**
 * Roles allowed to publish media in the broadcast.
 *
 * `participant` is the role EVERY joiner gets (video_join_room:360), so leaving
 * it out meant a Lynk was a broadcast: the host published, and every guest was
 * a silent, invisible viewer the host could not see. That is not what a Lynk
 * is. A room is capped at 2..50 and plan-limited at creation
 * (video_create_room:27), so "everyone who joins is on camera" is bounded —
 * this is the Zoom model, not an open firehose.
 *
 * A guest still chooses camera/mic in pre-join and can arrive with both off;
 * publishing is a CAPABILITY here, never a state.
 */
const PUBLISH_ROLES = new Set(["host", "co-host", "speaker", "participant"]);

/** Path-safe peer id derived from the user (anon users get a stable anon id). */
function peerIdFor(userId: string, anonLabel: string | null): string {
  if (anonLabel) {
    const n = anonLabel.match(/(\d+)/)?.[1] ?? "0";
    return `anon-${n}`;
  }
  // Better-Auth ids are already URL/path-safe; strip anything exotic defensively.
  return userId.replace(/[^a-zA-Z0-9_-]/g, "");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("validation_error", "Method not allowed");
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const fishjamId = Deno.env.get("FISHJAM_APP_ID")!;
    const managementToken = Deno.env.get("FISHJAM_API_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // 1. Verify Better-Auth session (shared helper — same as video_join_room)
    const sessionResult = await verifySessionDetailed(supabase, req);
    if (!sessionResult.ok) {
      if (sessionResult.reason === "missing") {
        return errorResponse("unauthorized", "Missing session token");
      }
      if (sessionResult.reason === "expired") {
        return errorResponse("unauthorized", "Session expired");
      }
      return errorResponse("unauthorized", "Invalid or expired session");
    }
    const userId = sessionResult.userId as string;

    // 2. Validate input
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }
    const parsed = TokenSchema.safeParse(body);
    if (!parsed.success) {
      return errorResponse("validation_error", parsed.error.errors[0].message);
    }
    const { roomId, intent } = parsed.data;

    async function authorizeAccess() {
      // Verified-only admission. A client that skips the banner is still refused.
      const admission = await resolveVerifiedAdmission(supabase, userId);
      if (admission.state === "blocked") {
        const refusal = admissionRefusal(admission);
        return moqAccessFailure("forbidden", refusal.message, { reason: refusal.reason });
      }

      // 3. Room must exist + be open
      const { data: room, error: roomError } = await supabase
        .from("video_rooms")
        .select("*")
        .eq("uuid", roomId)
        .maybeSingle();
      if (roomError) throw roomError;
      if (!room) return moqAccessFailure("not_found", "Room not found");
      if (room.status !== "open") {
        return moqAccessFailure("conflict", "Room is no longer open");
      }
      // Every media transport enforces current admission and schedule before tokens.
      const eventAccess = await resolveEventRoomAccess(supabase, room, userId);
      if (!eventAccess.ok) {
        return moqAccessFailure(eventAccess.code, eventAccess.message, eventAccess.detail);
      }
      room.ends_at = eventAccess.endsAt;
      if (room.ends_at && Date.parse(room.ends_at) <= Date.now()) {
        return moqAccessFailure("conflict", "This Lynk's session has ended", { reason: "session_expired" });
      }

      const internalRoomId = room.id;

      // 4. Ban check
      const { data: isBanned, error: banError } = await supabase.rpc("is_user_banned_from_room", {
        p_user_id: userId,
        p_room_id: internalRoomId,
      });
      if (banError) throw banError;
      if (isBanned) {
        return moqAccessFailure("forbidden", "You are banned from this room");
      }

      // 5. Existing membership (drives role + private-access)
      const { data: existingMember, error: memberError } = await supabase
        .from("video_room_members")
        .select("*")
        .eq("room_id", internalRoomId)
        .eq("user_id", userId)
        .maybeSingle();

      if (memberError) throw memberError;
      if (existingMember?.status === "kicked") {
        return moqAccessFailure("forbidden", "You have been removed from this room");
      }
      if (existingMember?.status === "banned") {
        return moqAccessFailure("forbidden", "You are banned from this room");
      }

      const isHostOrCoHost =
        userId === room.created_by ||
        existingMember?.role === "host" ||
        existingMember?.role === "co-host";

      // 6. Private-room access gate (verbatim from video_join_room)
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

        if (!isHostOrCoHost && !hasPriorAccess && !hasInvite) {
          return moqAccessFailure("forbidden", "This private Lynk is invite-only", {
            reason: "invite_only",
          });
        }
      }

      // 7. Determine effective role + publish capability
      const role = isHostOrCoHost
        ? (userId === room.created_by ? "host" : existingMember?.role ?? "co-host")
        : (existingMember?.role ?? "participant");
      const canPublish = role === "host" || PUBLISH_ROLES.has(role);

      if (intent === "publish" && !canPublish) {
        return moqAccessFailure("forbidden", "Not permitted to broadcast in this Lynk", {
          reason: "publish_not_allowed",
          role,
        });
      }

      // 8. Build the scoped path + mint the single-purpose MoQ token
      const peerId = peerIdFor(userId, existingMember?.anon_label ?? null);
      const namespace = `lynk/${roomId}`;
      const path = intent === "publish" ? `${namespace}/${peerId}` : namespace;

      return { ok: true as const, access: { role, peerId, path, namespace, endsAt: room.ends_at ?? null, memberStatus: existingMember?.status ?? null } };
    }

    const fishjam = new FishjamClient({ fishjamId, managementToken });
    // Both publish and subscribe credentials are signed, single-purpose, short
    // lived, and released only after a second authoritative admission check.
    const access = await mintBoundedMoqAccess({
      intent,
      authorize: authorizeAccess,
      mint: (config) => fishjam.createMoqAccess(config),
    });
    if (!access.ok) {
      return errorResponse(access.error.code, access.error.message, access.error.detail);
    }

    return jsonResponse({
      ok: true,
      data: {
        token: access.token,
        relayUrl: access.relayUrl,
        fishjamId,
        intent,
        role: access.access.role,
        peerId: access.access.peerId,
        // The publisher's own path (publish) or the room namespace (subscribe).
        path: access.access.path,
        // The room namespace — viewers subscribe here to discover all publishers.
        namespace: access.access.namespace,
        // The issued JWT expiry, never a synthetic lifetime from response time.
        expiresAt: access.expiresAt,
      },
    });
  } catch (err) {
    console.error("[lynk-moq-token] error:", err);
    return errorResponse("internal_error", "Failed to mint MoQ token");
  }
});
