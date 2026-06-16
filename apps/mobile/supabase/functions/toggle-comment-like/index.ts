/**
 * Edge Function: toggle-comment-like
 * Idempotent like/unlike on comments. Service-role gateway — clients never write directly.
 * Deploy: supabase functions deploy toggle-comment-like --no-verify-jwt --project-ref npfjanxturvmjyevoyfo
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
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

    const { data: sessionData, error: sessionError } = await supabaseAdmin
      .from("session")
      .select("id, token, userId, expiresAt")
      .eq("token", token)
      .single();

    if (sessionError || !sessionData) {
      console.log(`[Edge:toggle-comment-like] ${correlationId} unauthorized: invalid session`);
      return errorResponse("unauthorized", "Invalid or expired session");
    }
    if (new Date(sessionData.expiresAt) < new Date()) {
      return errorResponse("unauthorized", "Session expired");
    }

    const authUserId = sessionData.userId;

    let body: { commentId: number; like?: boolean };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { commentId, like: desiredLike } = body;
    if (!commentId || typeof commentId !== "number") {
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

    const { data: existing } = await supabaseAdmin
      .from("comment_likes")
      .select("user_id")
      .eq("comment_id", commentId)
      .eq("user_id", userId)
      .single();

    const currentlyLiked = !!existing;

    if (typeof desiredLike === "boolean" && desiredLike === currentlyLiked) {
      const { data: commentData } = await supabaseAdmin
        .from("comments")
        .select("likes_count")
        .eq("id", commentId)
        .single();
      const likesCount = commentData?.likes_count ?? 0;
      const updatedAt = new Date().toISOString();
      console.log(`[Edge:toggle-comment-like] ${correlationId} idempotent commentId=${commentId} userId=${userId} liked=${currentlyLiked} count=${likesCount}`);
      return jsonResponse({
        ok: true,
        data: {
          commentId: String(commentId),
          likeCount: likesCount,
          viewerHasLiked: currentlyLiked,
          updatedAt,
          liked: currentlyLiked,
          likesCount,
        },
      });
    }

    if (currentlyLiked) {
      const { error: delErr } = await supabaseAdmin
        .from("comment_likes")
        .delete()
        .eq("comment_id", commentId)
        .eq("user_id", userId);

      if (delErr) {
        console.error(`[Edge:toggle-comment-like] ${correlationId} delete_error:`, delErr);
        return errorResponse("internal_error", "Failed to unlike");
      }
    } else {
      const { error: insertErr } = await supabaseAdmin
        .from("comment_likes")
        .insert({ comment_id: commentId, user_id: userId });

      if (insertErr) {
        if (insertErr.code === "23505") {
          const { data: c } = await supabaseAdmin
            .from("comments")
            .select("likes_count")
            .eq("id", commentId)
            .single();
          const likesCount = c?.likes_count ?? 0;
          const updatedAt = new Date().toISOString();
          console.log(`[Edge:toggle-comment-like] ${correlationId} idempotent_duplicate commentId=${commentId} count=${likesCount}`);
          return jsonResponse({
            ok: true,
            data: {
              commentId: String(commentId),
              likeCount: likesCount,
              viewerHasLiked: true,
              updatedAt,
              liked: true,
              likesCount,
            },
          });
        }
        console.error(`[Edge:toggle-comment-like] ${correlationId} insert_error:`, insertErr);
        return errorResponse("internal_error", "Failed to like");
      }
    }

    const { data: commentData } = await supabaseAdmin
      .from("comments")
      .select("likes_count")
      .eq("id", commentId)
      .single();

    const likesCount = commentData?.likes_count ?? 0;
    const liked = !currentlyLiked;
    const updatedAt = new Date().toISOString();

    console.log(`[Edge:toggle-comment-like] ${correlationId} success commentId=${commentId} userId=${userId} action=${currentlyLiked ? "unlike" : "like"} count=${likesCount}`);

    return jsonResponse({
      ok: true,
      data: {
        commentId: String(commentId),
        likeCount: likesCount,
        viewerHasLiked: liked,
        updatedAt,
        liked,
        likesCount,
      },
    });
  } catch (err) {
    console.error(`[Edge:toggle-comment-like] ${correlationId} unexpected_error:`, err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
