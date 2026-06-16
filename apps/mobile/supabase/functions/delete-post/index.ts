/**
 * Edge Function: delete-post
 * Delete a post with Better Auth verification
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

function errorResponse(code: string, message: string, status = 200): Response {
  return jsonResponse({ ok: false, error: { code, message } }, status);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST")
    return errorResponse("validation_error", "Method not allowed");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer "))
      return errorResponse(
        "unauthorized",
        "Missing or invalid Authorization header",
      );

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

    let body: { postId: number };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { postId } = body;
    if (!postId) return errorResponse("validation_error", "postId is required");

    const userData = await resolveOrProvisionUser(
      supabaseAdmin,
      authUserId,
      "id, posts_count",
    );
    if (!userData) return errorResponse("not_found", "User not found");

    // Verify ownership
    const { data: post } = await supabaseAdmin
      .from("posts")
      .select("author_id")
      .eq("id", postId)
      .single();
    if (!post || post.author_id !== userData.id)
      return errorResponse("forbidden", "You can only delete your own posts");

    // Delete all dependent rows first (foreign keys may not have ON DELETE CASCADE)
    await Promise.all([
      supabaseAdmin.from("posts_media").delete().eq("parent_id", postId),
      supabaseAdmin.from("post_text_slides").delete().eq("post_id", postId),
      supabaseAdmin.from("comments").delete().eq("post_id", postId),
      supabaseAdmin.from("post_likes").delete().eq("post_id", postId),
      supabaseAdmin.from("bookmarks").delete().eq("post_id", postId),
      supabaseAdmin.from("post_tags").delete().eq("post_id", postId),
      supabaseAdmin.from("notifications").delete().eq("post_id", postId),
    ]);

    // Delete post
    const { error } = await supabaseAdmin
      .from("posts")
      .delete()
      .eq("id", postId);
    if (error) {
      console.error("[Edge:delete-post] DB delete error:", error);
      return errorResponse("internal_error", "Failed to delete post");
    }

    // posts_count synced by trigger on posts table

    return jsonResponse({ ok: true, data: { success: true } });
  } catch (err) {
    console.error("[Edge:delete-post] Error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
