/**
 * Edge Function: post-like
 * Idempotent LIKE on a post. If already liked, returns current state (no error).
 * Returns authoritative { postId, liked, likesCount, viewerHasLiked }.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";

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

function errorResponse(
  code: string,
  message: string,
  status = 200,
): Response {
  console.error(`[Edge:post-like] Error: ${code} - ${message}`);
  return jsonResponse({ ok: false, error: { code, message } }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return errorResponse("validation_error", "Method not allowed", 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("unauthorized", "Missing or invalid Authorization header", 401);
    }
    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse("internal_error", "Server configuration error", 500);
    }
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    // Verify Better Auth session
    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from("session")
      .select("id, token, userId, expiresAt")
      .eq("token", token)
      .single();

    if (sessionError || !sessionData) {
      return errorResponse("unauthorized", "Invalid or expired session", 401);
    }
    if (new Date(sessionData.expiresAt) < new Date()) {
      return errorResponse("unauthorized", "Session expired", 401);
    }

    const authUserId = sessionData.userId;

    // Parse body
    let body: { postId: number };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body", 400);
    }

    const { postId } = body;
    if (!postId || typeof postId !== "number") {
      return errorResponse("validation_error", "postId is required and must be a number", 400);
    }

    // Resolve user
    const userData = await resolveOrProvisionUser(supabaseAdmin, authUserId, "id");
    if (!userData) return errorResponse("not_found", "User not found", 404);
    const userId = userData.id;

    console.log(`[Edge:post-like] userId=${userId} postId=${postId}`);

    // Idempotent INSERT — ON CONFLICT DO NOTHING (requires unique constraint)
    const { error: insertError } = await supabaseAdmin
      .from("likes")
      .upsert(
        { user_id: userId, post_id: postId },
        { onConflict: "user_id,post_id", ignoreDuplicates: true },
      );

    if (insertError) {
      console.error("[Edge:post-like] Insert error:", insertError);
      return errorResponse("internal_error", "Failed to like post");
    }

    // Read authoritative count (trigger-maintained)
    const { data: postData } = await supabaseAdmin
      .from("posts")
      .select("likes_count")
      .eq("id", postId)
      .single();

    const likesCount = postData?.likes_count ?? 0;

    // Fire-and-forget: notification to post author
    try {
      const { data: postAuthor } = await supabaseAdmin
        .from("posts")
        .select("author_id")
        .eq("id", postId)
        .single();

      if (postAuthor?.author_id && postAuthor.author_id !== userId) {
        // Upsert notification (idempotent — don't spam on rapid re-likes)
        await supabaseAdmin.from("notifications").upsert(
          {
            recipient_id: postAuthor.author_id,
            actor_id: userId,
            type: "like",
            entity_type: "post",
            entity_id: String(postId),
          },
          { onConflict: "recipient_id,actor_id,type,entity_type,entity_id", ignoreDuplicates: true },
        );

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
            headers: { "Content-Type": "application/json", Accept: "application/json" },
            body: JSON.stringify(messages),
          });
        }
      }
    } catch (notifErr) {
      console.error("[Edge:post-like] Notification error (non-fatal):", notifErr);
    }

    console.log(`[Edge:post-like] OK: liked=true likesCount=${likesCount}`);
    return jsonResponse({
      ok: true,
      data: { postId, liked: true, likesCount, viewerHasLiked: true },
    });
  } catch (err) {
    console.error("[Edge:post-like] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});
