/**
 * Edge Function: toggle-bookmark
 * Toggle bookmark on a post with Better Auth verification
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
  console.error(`[Edge:toggle-bookmark] Error: ${code} - ${message}`);
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
    console.log(
      "[Edge:toggle-bookmark] Authenticated user auth_id:",
      authUserId,
    );

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
    console.log("[Edge:toggle-bookmark] User ID:", userId, "Post ID:", postId);

    // Check if already bookmarked
    const { data: existingBookmark } = await supabaseAdmin
      .from("bookmarks")
      .select("id")
      .eq("user_id", userId)
      .eq("post_id", postId)
      .single();

    let bookmarked: boolean;

    if (existingBookmark) {
      // Remove bookmark
      const { error: deleteError } = await supabaseAdmin
        .from("bookmarks")
        .delete()
        .eq("user_id", userId)
        .eq("post_id", postId);

      if (deleteError) {
        console.error("[Edge:toggle-bookmark] Delete error:", deleteError);
        return errorResponse("internal_error", "Failed to remove bookmark");
      }
      bookmarked = false;
    } else {
      // Add bookmark
      const { error: insertError } = await supabaseAdmin
        .from("bookmarks")
        .insert({ user_id: userId, post_id: postId });

      if (insertError) {
        console.error("[Edge:toggle-bookmark] Insert error:", insertError);
        return errorResponse("internal_error", "Failed to add bookmark");
      }
      bookmarked = true;
    }

    console.log("[Edge:toggle-bookmark] Result:", { bookmarked });

    return jsonResponse({
      ok: true,
      data: { bookmarked },
    });
  } catch (err) {
    console.error("[Edge:toggle-bookmark] Unexpected error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
