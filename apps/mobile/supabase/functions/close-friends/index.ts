/**
 * Edge Function: close-friends
 * CRUD for close friends list.
 * Actions: list, add, remove, check
 * Uses Better Auth session verification via direct DB lookup.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
  return jsonResponse({ ok: false, error: { code, message } }, 200);
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
    if (!supabaseUrl || !supabaseServiceKey)
      return errorResponse("internal_error", "Server configuration error");

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
    const ownerAuthId = authUserId;

    let body: { action: string; friendId?: number; friendIds?: number[] };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { action } = body;

    // ─── LIST: Get all close friends for the current user ───
    if (action === "list") {
      const { data: friends, error } = await supabaseAdmin
        .from("close_friends")
        .select("friend_id, created_at")
        .eq("owner_id", ownerAuthId)
        .order("created_at", { ascending: false });

      if (error) {
        console.error("[close-friends] list error:", error);
        return errorResponse("internal_error", "Failed to fetch close friends");
      }

      const friendIds = (friends || []).map((f: any) => f.friend_id);

      if (friendIds.length === 0) {
        return jsonResponse({ ok: true, data: { friends: [], friendIds: [] } });
      }

      // Fetch user details
      const { data: users } = await supabaseAdmin
        .from("users")
        .select("id, username, first_name, last_name, avatar:avatar_id(url)")
        .in("id", friendIds);

      const friendsList = (users || []).map((u: any) => ({
        id: u.id,
        username: u.username || "",
        name:
          [u.first_name, u.last_name].filter(Boolean).join(" ") ||
          u.username ||
          "",
        avatar: u.avatar?.url || null,
      }));

      return jsonResponse({
        ok: true,
        data: { friends: friendsList, friendIds },
      });
    }

    // ─── ADD: Add a user to close friends ───
    if (action === "add") {
      const { friendId } = body;
      if (!friendId || typeof friendId !== "number")
        return errorResponse(
          "validation_error",
          "friendId (number) is required",
        );

      // Verify the friend user exists
      const { data: friendUser } = await supabaseAdmin
        .from("users")
        .select("id")
        .eq("id", friendId)
        .single();

      if (!friendUser) return errorResponse("not_found", "User not found");

      // Upsert (ignore if already exists)
      const { error } = await supabaseAdmin
        .from("close_friends")
        .upsert(
          { owner_id: ownerAuthId, friend_id: friendId },
          { onConflict: "owner_id,friend_id" },
        );

      if (error) {
        console.error("[close-friends] add error:", error);
        return errorResponse("internal_error", "Failed to add close friend");
      }

      return jsonResponse({ ok: true, data: { added: friendId } });
    }

    // ─── REMOVE: Remove a user from close friends ───
    if (action === "remove") {
      const { friendId } = body;
      if (!friendId || typeof friendId !== "number")
        return errorResponse(
          "validation_error",
          "friendId (number) is required",
        );

      const { error } = await supabaseAdmin
        .from("close_friends")
        .delete()
        .eq("owner_id", ownerAuthId)
        .eq("friend_id", friendId);

      if (error) {
        console.error("[close-friends] remove error:", error);
        return errorResponse("internal_error", "Failed to remove close friend");
      }

      return jsonResponse({ ok: true, data: { removed: friendId } });
    }

    // ─── CHECK: Check if specific users are close friends ───
    if (action === "check") {
      const { friendIds } = body;
      if (!friendIds || !Array.isArray(friendIds))
        return errorResponse(
          "validation_error",
          "friendIds (array) is required",
        );

      const { data: existing } = await supabaseAdmin
        .from("close_friends")
        .select("friend_id")
        .eq("owner_id", ownerAuthId)
        .in("friend_id", friendIds);

      const closeFriendSet = new Set(
        (existing || []).map((e: any) => e.friend_id),
      );
      const results: Record<number, boolean> = {};
      for (const id of friendIds) {
        results[id] = closeFriendSet.has(id);
      }

      return jsonResponse({ ok: true, data: { results } });
    }

    return errorResponse(
      "validation_error",
      'Invalid action. Use "list", "add", "remove", or "check".',
    );
  } catch (err) {
    console.error("[Edge:close-friends] Error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
