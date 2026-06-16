/**
 * Edge Function: lynk-moq-token
 *
 * Mints a PATH-SCOPED, SINGLE-PURPOSE Media-over-QUIC (MoQ) token for Sneaky
 * Lynk live rooms (the "Lynk Live" broadcast). This is the MoQ analogue of
 * `video_join_room` — it reuses the EXACT same Better-Auth session verification
 * and private-room authorization gate (host / co-host / prior member / invite /
 * public), then mints a Fishjam MoQ token via `@fishjam-cloud/js-server-sdk`
 * `createMoqToken({ publishPath | subscribePath })` instead of a WebRTC peer
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
 * server-side by which field we pass to createMoqToken). A broadcaster requests
 * BOTH a publish token (own path) and a subscribe token (namespace) — two calls.
 *
 * Management token (`FISHJAM_API_KEY`) NEVER leaves the server; the client only
 * receives the scoped MoQ token + the public `FISHJAM_APP_ID` + the relay URL.
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

/** Roles allowed to publish media in the broadcast (multi-speaker model). */
const PUBLISH_ROLES = new Set(["host", "co-host", "speaker"]);

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
    const authHeader = req.headers.get("Authorization");
    const customToken = req.headers.get("x-auth-token");
    const jwt = (customToken || authHeader?.replace("Bearer ", "") || "").trim();
    if (!jwt) {
      return errorResponse("unauthorized", "Missing session token");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const fishjamId = Deno.env.get("FISHJAM_APP_ID")!;
    const managementToken = Deno.env.get("FISHJAM_API_KEY")!;

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // 1. Verify Better-Auth session (direct DB lookup — same as video_join_room)
    const { data: session } = await supabase
      .from("session")
      .select("userId, expiresAt")
      .eq("token", jwt)
      .order("createdAt", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!session) {
      return errorResponse("unauthorized", "Invalid or expired session");
    }
    if (new Date(session.expiresAt) < new Date()) {
      return errorResponse("unauthorized", "Session expired");
    }
    const userId = session.userId as string;

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

    // 3. Room must exist + be open
    const { data: room } = await supabase
      .from("video_rooms")
      .select("*")
      .eq("uuid", roomId)
      .single();
    if (!room) return errorResponse("not_found", "Room not found");
    if (room.status !== "open") {
      return errorResponse("conflict", "Room is no longer open");
    }
    const internalRoomId = room.id;

    // 4. Ban check
    const { data: isBanned } = await supabase.rpc("is_user_banned_from_room", {
      p_user_id: userId,
      p_room_id: internalRoomId,
    });
    if (isBanned) {
      return errorResponse("forbidden", "You are banned from this room");
    }

    // 5. Existing membership (drives role + private-access)
    const { data: existingMember } = await supabase
      .from("video_room_members")
      .select("*")
      .eq("room_id", internalRoomId)
      .eq("user_id", userId)
      .maybeSingle();

    if (existingMember?.status === "banned") {
      return errorResponse("forbidden", "You are banned from this room");
    }

    const isHostOrCoHost =
      userId === room.created_by ||
      existingMember?.role === "host" ||
      existingMember?.role === "co-host";

    // 6. Private-room access gate (verbatim from video_join_room)
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

      if (!isHostOrCoHost && !hasPriorAccess && !hasInvite) {
        return errorResponse("forbidden", "This private Lynk is invite-only", {
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
      return errorResponse("forbidden", "Not permitted to broadcast in this Lynk", {
        reason: "publish_not_allowed",
        role,
      });
    }

    // 8. Build the scoped path + mint the single-purpose MoQ token
    const peerId = peerIdFor(userId, existingMember?.anon_label ?? null);
    const namespace = `lynk/${roomId}`;
    const path = intent === "publish" ? `${namespace}/${peerId}` : namespace;

    const fishjam = new FishjamClient({ fishjamId, managementToken });
    const { token } =
      intent === "publish"
        ? await fishjam.createMoqToken({ publishPath: path })
        : await fishjam.createMoqToken({ subscribePath: path });

    const relayUrl = `https://relay.fishjam.io/${fishjamId}?jwt=${token}`;

    return jsonResponse({
      ok: true,
      data: {
        token,
        relayUrl,
        fishjamId,
        intent,
        role,
        peerId,
        // The publisher's own path (publish) or the room namespace (subscribe).
        path,
        // The room namespace — viewers subscribe here to discover all publishers.
        namespace,
        // Mirror video_join_room's 1h client-side refresh cadence.
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    });
  } catch (err) {
    console.error("[lynk-moq-token] error:", err);
    return errorResponse("internal_error", "Failed to mint MoQ token");
  }
});
