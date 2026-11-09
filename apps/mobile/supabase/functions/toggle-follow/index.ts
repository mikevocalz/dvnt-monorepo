/**
 * Edge Function: toggle-follow
 * Explicit follow/unfollow a user with Better Auth verification.
 * Accepts `action: "follow" | "unfollow"` for idempotent, race-free mutations.
 * Older clients may omit action for a serialized follow/request toggle.
 * Returns authoritative counts + viewerFollows + target username.
 *
 * Deploy: supabase functions deploy toggle-follow --no-verify-jwt --project-ref npfjanxturvmjyevoyfo
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySessionDetailed } from "../_shared/verify-session.ts";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";
import { checkRateLimit, WRITE_LIMIT } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function jsonResponse<T>(data: ApiResponse<T>, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function errorResponse(code: string, message: string): Response {
  console.error(`[Edge:toggle-follow] Error: ${code} - ${message}`);
  return jsonResponse({ ok: false, error: { code, message } }, 200);
}

function genCorrelationId(): string {
  return `fl_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return errorResponse("validation_error", "Method not allowed");
  }

  const correlationId = genCorrelationId();

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse(
        "unauthorized",
        "Missing or invalid Authorization header",
      );
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse("internal_error", "Server configuration error");
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // Verify Better Auth session via shared helper
    const sessionResult = await verifySessionDetailed(supabaseAdmin, req);
    if (!sessionResult.ok) {
      if (sessionResult.reason === "expired") {
        return errorResponse("unauthorized", "Session expired");
      }
      return errorResponse("unauthorized", "Invalid or expired session");
    }

    const authUserId = sessionResult.userId;

    let body: {
      targetUserId?: number;
      targetAuthId?: string;
      expectedAuthId?: string;
      action?: "follow" | "unfollow" | "approve" | "decline" | "status" | "requests";
    };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    // New clients bind intent to the original sign-in. The verified token
    // remains authoritative; an expected owner can only restrict it.
    if (Object.prototype.hasOwnProperty.call(body, "expectedAuthId") && body.expectedAuthId !== authUserId) {
      return errorResponse("unauthorized", "Account changed. Reload before trying again.");
    }

    let { targetUserId } = body;
    const { targetAuthId } = body;

    // Only omitted actions use the legacy contract. Malformed/unknown explicit
    // actions must never become an accidental mutation (including "toggle").
    const legacyToggle = !Object.prototype.hasOwnProperty.call(body, "action");
    if (!legacyToggle && !["follow", "unfollow", "approve", "decline", "status", "requests"].includes(body.action || "")) {
      return errorResponse("validation_error", "Invalid follow action");
    }
    // Resolve the old toggle inside the same locked transaction as the write,
    // never by reading the current relationship in this Edge handler.
    const action = legacyToggle ? "toggle" : body.action;
    const readOnly = action === "status" || action === "requests";
    const rl = checkRateLimit(authUserId, readOnly ? "follow-requests-read" : "toggle-follow", readOnly ? { maxRequests: 120, windowMs: 60_000 } : WRITE_LIMIT);
    if (!rl.allowed) return errorResponse("rate_limited", "Too many requests. Try again shortly.");
    const callerData = await resolveOrProvisionUser(supabaseAdmin, authUserId, "id");
    if (!callerData) return errorResponse("not_found", "Caller user not found");
    const userId = callerData.id;
    if (action === "requests") {
      const { data: requests, error } = await supabaseAdmin.from("follow_requests")
        .select("follower_id, created_at, requester:users!follow_requests_follower_id_fkey(username)")
        .eq("following_id", userId).eq("status", "pending").order("created_at", { ascending: true }).limit(100);
      if (error) return errorResponse("internal_error", "Could not load follow requests");
      return jsonResponse({ ok: true, data: { requests } });
    }
    if (!targetUserId && !targetAuthId) return errorResponse("validation_error", "Target member is required");

    // Resolve targetAuthId → integer ID (auto-provision if needed)
    if (!targetUserId && targetAuthId) {
      console.log(
        `[Edge:toggle-follow] ${correlationId} resolving targetAuthId: ${targetAuthId}`,
      );
      const targetData = await resolveOrProvisionUser(
        supabaseAdmin,
        targetAuthId,
        "id",
      );
      if (!targetData) {
        return errorResponse("not_found", "Target user not found");
      }
      targetUserId = targetData.id;
    }

    if (!targetUserId || typeof targetUserId !== "number") {
      return errorResponse(
        "validation_error",
        "Could not resolve target user ID",
      );
    }

    if (!Number.isSafeInteger(targetUserId) || targetUserId <= 0 || userId === targetUserId) {
      return errorResponse("validation_error", "Invalid target member");
    }
    const { data: relationship, error: mutationError } = await supabaseAdmin.rpc("mutate_follow_relationship", {
      p_actor: userId, p_target: targetUserId, p_action: action,
    });
    if (mutationError || !relationship) return errorResponse("internal_error", "Could not update follow relationship");
    if (action === "approve" || action === "decline" || action === "status") {
      return jsonResponse({ ok: true, data: relationship });
    }
    const following = relationship.following === true;
    if (relationship.notifyFollow === true) {
      sendFollowNotification(supabaseAdmin, userId, targetUserId).catch(console.error);
    }

    // ── Read authoritative counts + target username in ONE query ──
    const { data: targetUser } = await supabaseAdmin
      .from("users")
      .select("username, followers_count, following_count")
      .eq("id", targetUserId)
      .single();

    const { data: callerUser } = await supabaseAdmin
      .from("users")
      .select("followers_count, following_count")
      .eq("id", userId)
      .single();

    const updatedAt = new Date().toISOString();

    console.log(
      `[Edge:toggle-follow] ${correlationId} success following=${following} ` +
        `targetFollowers=${targetUser?.followers_count} callerFollowing=${callerUser?.following_count}`,
    );

    return jsonResponse({
      ok: true,
      data: {
        following,
        followRequestStatus: relationship.followRequestStatus,
        targetUserId: String(targetUserId),
        targetUsername: targetUser?.username || "",
        viewerFollows: following,
        targetFollowersCount: targetUser?.followers_count ?? 0,
        targetFollowingCount: targetUser?.following_count ?? 0,
        callerFollowersCount: callerUser?.followers_count ?? 0,
        callerFollowingCount: callerUser?.following_count ?? 0,
        updatedAt,
        correlationId,
      },
    });
  } catch (err) {
    console.error(
      `[Edge:toggle-follow] ${correlationId} unexpected_error:`,
      err,
    );
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});

// ── Fire-and-forget notification helper ──
async function sendFollowNotification(
  supabaseAdmin: any,
  followerId: number,
  targetId: number,
) {
  const { data: followerData } = await supabaseAdmin
    .from("users")
    .select("username, avatar_id(url)")
    .eq("id", followerId)
    .single();

  const followerUsername = followerData?.username || "Someone";
  const followerAvatar = (followerData?.avatar_id as any)?.url || "";

  // Insert notification row
  await supabaseAdmin.from("notifications").insert({
    recipient_id: targetId,
    sender_id: followerId,
    type: "follow",
    entity_type: "user",
    entity_id: String(followerId),
  });

  // Send push
  const { data: tokens } = await supabaseAdmin
    .from("push_tokens")
    .select("token")
    .eq("user_id", targetId);

  if (tokens && tokens.length > 0) {
    const messages = tokens.map((t: { token: string }) => ({
      to: t.token,
      title: "New Follower",
      body: `${followerUsername} started following you`,
      data: {
        type: "follow",
        senderId: String(followerId),
        senderUsername: followerUsername !== "Someone" ? followerUsername : undefined,
        senderAvatar: followerAvatar,
        entityType: "user",
        entityId: String(followerId),
        // Canonical URL — notification router resolves this first
        url: followerUsername !== "Someone"
          ? `https://dvntapp.live/u/${followerUsername}`
          : `https://dvntapp.live/user/${followerId}`,
      },
      sound: "default",
      channelId: "default",
    }));

    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(messages),
    });
    console.log(
      "[Edge:toggle-follow] Push sent to",
      tokens.length,
      "device(s)",
    );
  }
}
