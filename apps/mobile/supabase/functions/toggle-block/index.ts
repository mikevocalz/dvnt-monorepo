/**
 * Edge Function: toggle-block
 * Block/unblock a user with Better Auth verification
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
        401,
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

    let body: { targetUserId?: number; targetAuthId?: string };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    let { targetUserId } = body;
    const { targetAuthId } = body;
    if (!targetUserId && !targetAuthId)
      return errorResponse(
        "validation_error",
        "targetUserId or targetAuthId is required",
      );

    // Resolve targetAuthId if provided
    if (!targetUserId && targetAuthId) {
      const targetData = await resolveOrProvisionUser(
        supabaseAdmin,
        targetAuthId,
        "id",
      );
      if (!targetData)
        return errorResponse("not_found", "Target user not found");
      targetUserId = targetData.id;
    }

    const userData = await resolveOrProvisionUser(
      supabaseAdmin,
      authUserId,
      "id",
    );
    if (!userData) return errorResponse("not_found", "User not found");

    if (userData.id === targetUserId)
      return errorResponse("validation_error", "Cannot block yourself");

    // Check if already blocked
    const { data: existingBlock } = await supabaseAdmin
      .from("blocks")
      .select("id")
      .eq("blocker_id", userData.id)
      .eq("blocked_id", targetUserId)
      .single();

    let blocked: boolean;

    if (existingBlock) {
      // Unblock
      await supabaseAdmin.from("blocks").delete().eq("id", existingBlock.id);
      blocked = false;
    } else {
      // Block
      await supabaseAdmin
        .from("blocks")
        .insert({ blocker_id: userData.id, blocked_id: targetUserId });
      blocked = true;
    }

    return jsonResponse({ ok: true, data: { blocked } });
  } catch (err) {
    console.error("[Edge:toggle-block] Error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
