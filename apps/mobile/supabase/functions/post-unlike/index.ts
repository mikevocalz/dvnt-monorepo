/**
 * Edge Function: post-unlike
 * Idempotent UNLIKE on a post. If not liked, returns current state (no error).
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
  console.error(`[Edge:post-unlike] Error: ${code} - ${message}`);
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

    console.log(`[Edge:post-unlike] userId=${userId} postId=${postId}`);

    // Idempotent DELETE — no error if row doesn't exist
    const { error: deleteError } = await supabaseAdmin
      .from("likes")
      .delete()
      .eq("user_id", userId)
      .eq("post_id", postId);

    if (deleteError) {
      console.error("[Edge:post-unlike] Delete error:", deleteError);
      return errorResponse("internal_error", "Failed to unlike post");
    }

    // Read authoritative count (trigger-maintained)
    const { data: postData } = await supabaseAdmin
      .from("posts")
      .select("likes_count")
      .eq("id", postId)
      .single();

    const likesCount = postData?.likes_count ?? 0;

    // Remove like notification (fire-and-forget)
    try {
      await supabaseAdmin
        .from("notifications")
        .delete()
        .eq("actor_id", userId)
        .eq("type", "like")
        .eq("entity_type", "post")
        .eq("entity_id", String(postId));
    } catch {
      // non-fatal
    }

    console.log(`[Edge:post-unlike] OK: liked=false likesCount=${likesCount}`);
    return jsonResponse({
      ok: true,
      data: { postId, liked: false, likesCount, viewerHasLiked: false },
    });
  } catch (err) {
    console.error("[Edge:post-unlike] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred", 500);
  }
});
