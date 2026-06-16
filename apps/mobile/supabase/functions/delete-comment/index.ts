/**
 * Edge Function: delete-comment
 * Delete a comment with Better Auth verification
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

function errorResponse(code: string, message: string): Response {
  console.error(`[Edge:delete-comment] Error: ${code} - ${message}`);
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

    let body: { commentId: number };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { commentId } = body;
    if (!commentId || typeof commentId !== "number") {
      return errorResponse(
        "validation_error",
        "commentId is required and must be a number",
      );
    }

    // Get user's integer ID (auto-provision if needed)
    const userData = await resolveOrProvisionUser(
      supabaseAdmin,
      authUserId,
      "id",
    );
    if (!userData) return errorResponse("not_found", "User not found");

    const userId = userData.id;

    // Get comment to verify ownership and get post_id
    const { data: comment, error: commentError } = await supabaseAdmin
      .from("comments")
      .select("id, author_id, post_id")
      .eq("id", commentId)
      .single();

    if (commentError || !comment) {
      return errorResponse("not_found", "Comment not found");
    }

    // Verify ownership
    if (comment.author_id !== userId) {
      return errorResponse(
        "forbidden",
        "You can only delete your own comments",
      );
    }

    console.log("[Edge:delete-comment] User:", userId, "Comment:", commentId);

    // Delete comment
    const { error: deleteError } = await supabaseAdmin
      .from("comments")
      .delete()
      .eq("id", commentId);

    if (deleteError) {
      console.error("[Edge:delete-comment] Delete error:", deleteError);
      return errorResponse("internal_error", "Failed to delete comment");
    }

    // comments_count synced by trigger on comments table

    console.log("[Edge:delete-comment] Comment deleted:", commentId);

    return jsonResponse({
      ok: true,
      data: { success: true },
    });
  } catch (err) {
    console.error("[Edge:delete-comment] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
