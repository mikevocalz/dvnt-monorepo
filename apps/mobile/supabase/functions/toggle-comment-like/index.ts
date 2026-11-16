/**
 * Edge Function: toggle-comment-like
 * Idempotent like/unlike on comments. Service-role gateway — clients never write directly.
 * Deploy: supabase functions deploy toggle-comment-like --no-verify-jwt --project-ref npfjanxturvmjyevoyfo
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySessionDetailed } from "../_shared/verify-session.ts";
import { projectVisiblePosts } from "../_shared/post-access.ts";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Cache-Control": "private, no-store",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LikeResponse {
  commentId: string;
  likeCount: number;
  viewerHasLiked: boolean;
  updatedAt: string;
}

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
  console.error(`[Edge:toggle-comment-like] Error: ${code} - ${message}`);
  return jsonResponse({ ok: false, error: { code, message } }, 200);
}

function genCorrelationId(): string {
  return `cl_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
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
      console.log(`[Edge:toggle-comment-like] ${correlationId} unauthorized: no token`);
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
      console.log(`[Edge:toggle-comment-like] ${correlationId} unauthorized: invalid session`);
      return errorResponse("unauthorized", "Invalid or expired session");
    }

    const authUserId = sessionResult.userId;

    let body: { commentId: number; like?: boolean };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { commentId, like: desiredLike } = body;
    if (!Number.isSafeInteger(commentId) || commentId <= 0 ||
        (desiredLike !== undefined && typeof desiredLike !== "boolean")) {
      return errorResponse(
        "validation_error",
        "commentId is required and must be a number",
      );
    }

    const userData = await resolveOrProvisionUser(
      supabaseAdmin,
      authUserId,
      "id",
    );
    if (!userData) {
      console.log(`[Edge:toggle-comment-like] ${correlationId} user_not_found authId=${authUserId}`);
      return errorResponse("not_found", "User not found");
    }

    const userId = userData.id;

    // Fetch only parent metadata and the total. Never infer an event from an
    // unrelated event_comments row with the same integer ID.
    const visibleComment = async () => {
      const { data: comment, error } = await supabaseAdmin.from("comments")
        .select("id, post_id, likes_count").eq("id", commentId).maybeSingle();
      if (error || !comment || !Number.isSafeInteger(Number(comment.post_id)) || Number(comment.post_id) <= 0) return null;
      const parent = await supabaseAdmin.from("posts")
        .select("id, author_id, visibility, is_nsfw").eq("id", comment.post_id).maybeSingle();
      if (parent.error || !parent.data) return null;
      const visible = await projectVisiblePosts(supabaseAdmin, [parent.data], {
        authId: authUserId, userId: Number(userId),
      });
      return visible.length ? comment : null;
    };
    const { data: existing, error: lookupError } = await supabaseAdmin
      .from("comment_likes").select("user_id")
      .eq("comment_id", commentId).eq("user_id", userId).maybeSingle();
    if (lookupError) return errorResponse("internal_error", "Could not verify like");
    const currentlyLiked = !!existing;
    const liked = desiredLike ?? !currentlyLiked;
    // Only the caller's existing like may be removed after access is lost.
    if (liked && !await visibleComment()) return errorResponse("not_found", "Comment not found");
    if (liked !== currentlyLiked) {
      if (!liked) {
        const { error } = await supabaseAdmin.from("comment_likes").delete()
          .eq("comment_id", commentId).eq("user_id", userId);
        if (error) return errorResponse("internal_error", "Failed to unlike");
      } else {
        const { error } = await supabaseAdmin.from("comment_likes")
          .insert({ comment_id: commentId, user_id: userId });
        if (error && error.code !== "23505") return errorResponse("internal_error", "Failed to like");
      }
    }
    // Recheck fresh parent/relationship state after writes, including duplicate
    // and idempotent paths. Zero is a redaction sentinel, not an observed total.
    const comment = await visibleComment();
    const likesCount = comment?.likes_count ?? 0;
    return jsonResponse({ ok: true, data: {
      commentId: String(commentId), likeCount: likesCount, likesCount,
      viewerHasLiked: liked, liked, updatedAt: new Date().toISOString(),
      ...(!comment ? { countHidden: true } : {}),
    }});

  } catch (err) {
    console.error(`[Edge:toggle-comment-like] ${correlationId} unexpected_error:`, err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
