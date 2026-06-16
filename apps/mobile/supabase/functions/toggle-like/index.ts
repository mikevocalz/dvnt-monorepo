/**
 * Edge Function: toggle-like
 * Toggle like on a post with Better Auth verification
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";
import { withRetry } from "../_shared/with-retry.ts";
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
  console.error(`[Edge:toggle-like] Error: ${code} - ${message}`);
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
    console.log("[Edge:toggle-like] Authenticated user auth_id:", authUserId);

    // Rate limit check
    const rl = checkRateLimit(authUserId, "toggle-like", WRITE_LIMIT);
    if (!rl.allowed) {
      return errorResponse(
        "rate_limited",
        "Too many requests. Try again shortly.",
      );
    }

    // Parse body
    let body: { postId: number };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { postId } = body;
    if (!postId || typeof postId !== "number") {
      return errorResponse(
        "validation_error",
        "postId is required and must be a number",
        400,
      );
    }

    // Get Supabase admin client

    // Get user's integer ID from auth_id (auto-provision if needed)
    const userData = await resolveOrProvisionUser(
      supabaseAdmin,
      authUserId,
      "id",
    );
    if (!userData) return errorResponse("not_found", "User not found");

    const userId = userData.id;
    console.log("[Edge:toggle-like] User ID:", userId, "Post ID:", postId);

    // Check if already liked
    const { data: existingLike } = await withRetry(
      () =>
        supabaseAdmin
          .from("likes")
          .select("id")
          .eq("user_id", userId)
          .eq("post_id", postId)
          .single(),
      { label: "toggle-like:check" },
    );

    let liked: boolean;

    if (existingLike) {
      // Unlike - delete the like
      const { error: deleteError } = await withRetry(
        () =>
          supabaseAdmin
            .from("likes")
            .delete()
            .eq("user_id", userId)
            .eq("post_id", postId),
        { label: "toggle-like:delete" },
      );

      if (deleteError) {
        console.error("[Edge:toggle-like] Delete error:", deleteError);
        return errorResponse("internal_error", "Failed to unlike");
      }

      // likes_count synced by trigger on likes table
      liked = false;
    } else {
      // Like - insert new like
      const { error: insertError } = await withRetry(
        () =>
          supabaseAdmin
            .from("likes")
            .insert({ user_id: userId, post_id: postId }),
        { label: "toggle-like:insert" },
      );

      if (insertError) {
        console.error("[Edge:toggle-like] Insert error:", insertError);
        return errorResponse("internal_error", "Failed to like");
      }

      // likes_count synced by trigger on likes table
      liked = true;

      // ── Send like notification to post author (fire-and-forget) ──
      try {
        // Get post author
        const { data: postAuthor } = await supabaseAdmin
          .from("posts")
          .select("author_id")
          .eq("id", postId)
          .single();

        if (
          postAuthor &&
          postAuthor.author_id &&
          postAuthor.author_id !== userId
        ) {
          // Insert notification
          await supabaseAdmin.from("notifications").insert({
            recipient_id: postAuthor.author_id,
            actor_id: userId,
            type: "like",
            entity_type: "post",
            entity_id: String(postId),
          });

          // Send push notification
          const { data: likerData } = await supabaseAdmin
            .from("users")
            .select("username")
            .eq("id", userId)
            .single();

          const likerUsername = likerData?.username || "Someone";

          const { data: tokens } = await supabaseAdmin
            .from("push_tokens")
            .select("token")
            .eq("user_id", postAuthor.author_id);

          if (tokens && tokens.length > 0) {
            const messages = tokens.map((t: { token: string }) => ({
              to: t.token,
              title: "New Like",
              body: `${likerUsername} liked your post`,
              data: {
                type: "like",
                senderId: String(userId),
                senderUsername: likerUsername,
                entityType: "post",
                entityId: String(postId),
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
              "[Edge:toggle-like] Push notification sent to",
              tokens.length,
              "device(s)",
            );
          }
        }
      } catch (notifErr) {
        // Don't fail the like if notification fails
        console.error(
          "[Edge:toggle-like] Notification error (non-fatal):",
          notifErr,
        );
      }
    }

    // Get updated likes count
    const { data: postData } = await supabaseAdmin
      .from("posts")
      .select("likes_count")
      .eq("id", postId)
      .single();

    const likesCount = postData?.likes_count || 0;
    console.log("[Edge:toggle-like] Result:", { liked, likesCount });

    return jsonResponse({
      ok: true,
      data: { liked, likesCount },
    });
  } catch (err) {
    console.error("[Edge:toggle-like] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
