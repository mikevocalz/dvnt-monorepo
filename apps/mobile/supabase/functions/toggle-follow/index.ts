/**
 * Edge Function: toggle-follow
 * Explicit follow/unfollow a user with Better Auth verification.
 * Accepts `action: "follow" | "unfollow"` for idempotent, race-free mutations.
 * Returns authoritative counts + viewerFollows + target username.
 *
 * Deploy: supabase functions deploy toggle-follow --no-verify-jwt --project-ref npfjanxturvmjyevoyfo
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";
import { checkRateLimit, WRITE_LIMIT } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse("internal_error", "Server configuration error");
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // Verify Better Auth session via direct DB lookup
    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from("session")
      .select("id, token, userId, expiresAt")
      .eq("token", token)
      .single();

    if (sessionError || !sessionData) {
      return errorResponse("unauthorized", "Invalid or expired session");
    }
    if (new Date(sessionData.expiresAt) < new Date()) {
      return errorResponse("unauthorized", "Session expired");
    }

    const authUserId = sessionData.userId;

    // Rate limit check
    const rl = checkRateLimit(authUserId, "toggle-follow", WRITE_LIMIT);
    if (!rl.allowed) {
      return errorResponse(
        "rate_limited",
        "Too many requests. Try again shortly.",
      );
    }

    let body: {
      targetUserId?: number;
      targetAuthId?: string;
      action?: "follow" | "unfollow";
    };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    let { targetUserId } = body;
    const { targetAuthId, action } = body;

    // Validate action — explicit follow/unfollow required
    // Legacy callers without action fall back to toggle behavior
    const explicitAction =
      action === "follow" || action === "unfollow" ? action : null;

    if (!targetUserId && !targetAuthId) {
      return errorResponse(
        "validation_error",
        "targetUserId or targetAuthId is required",
      );
    }

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

    // Resolve caller's integer ID (auto-provision if needed)
    const callerData = await resolveOrProvisionUser(
      supabaseAdmin,
      authUserId,
      "id",
    );
    if (!callerData) return errorResponse("not_found", "Caller user not found");
    const userId = callerData.id;

    // Can't follow yourself
    if (userId === targetUserId) {
      return errorResponse("validation_error", "Cannot follow yourself");
    }

    // Check current state
    const { data: existingFollow } = await supabaseAdmin
      .from("follows")
      .select("id")
      .eq("follower_id", userId)
      .eq("following_id", targetUserId)
      .maybeSingle();

    const currentlyFollowing = !!existingFollow;

    // Determine desired state
    let wantFollow: boolean;
    if (explicitAction) {
      wantFollow = explicitAction === "follow";
    } else {
      // Legacy toggle behavior
      wantFollow = !currentlyFollowing;
    }

    console.log(
      `[Edge:toggle-follow] ${correlationId} user=${userId} target=${targetUserId} ` +
        `current=${currentlyFollowing} want=${wantFollow} action=${explicitAction || "toggle"}`,
    );

    let following: boolean;

    // Idempotent: if already in desired state, skip write
    if (wantFollow === currentlyFollowing) {
      following = currentlyFollowing;
      console.log(
        `[Edge:toggle-follow] ${correlationId} idempotent — already ${following ? "following" : "not following"}`,
      );
    } else if (wantFollow) {
      // FOLLOW — insert (ON CONFLICT DO NOTHING for idempotency)
      const { error: insertError } = await supabaseAdmin
        .from("follows")
        .upsert(
          { follower_id: userId, following_id: targetUserId },
          { onConflict: "follower_id,following_id", ignoreDuplicates: true },
        );

      if (insertError) {
        console.error(
          `[Edge:toggle-follow] ${correlationId} insert_error:`,
          insertError,
        );
        return errorResponse("internal_error", "Failed to follow");
      }

      // follow counts synced by trigger on follows table
      following = true;

      // ── Send follow notification (fire-and-forget) ──
      sendFollowNotification(supabaseAdmin, userId, targetUserId).catch((err) =>
        console.error(
          `[Edge:toggle-follow] ${correlationId} notification_error:`,
          err,
        ),
      );
    } else {
      // UNFOLLOW — delete (idempotent: no error if not found)
      const { error: deleteError } = await supabaseAdmin
        .from("follows")
        .delete()
        .eq("follower_id", userId)
        .eq("following_id", targetUserId);

      if (deleteError) {
        console.error(
          `[Edge:toggle-follow] ${correlationId} delete_error:`,
          deleteError,
        );
        return errorResponse("internal_error", "Failed to unfollow");
      }

      // follow counts synced by trigger on follows table
      following = false;
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
