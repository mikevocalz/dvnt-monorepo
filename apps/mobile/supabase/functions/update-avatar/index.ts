/**
 * Edge Function: update-avatar
 * Update user avatar with Better Auth verification
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonOk(data: unknown): Response {
  return new Response(JSON.stringify({ ok: true, data }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function jsonErr(code: string, message: string): Response {
  return new Response(JSON.stringify({ ok: false, error: { code, message } }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: corsHeaders });
  if (req.method !== "POST")
    return jsonErr("validation_error", "Method not allowed");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer "))
      return jsonErr("unauthorized", "Missing or invalid Authorization header");

    const token = authHeader.replace("Bearer ", "");

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!supabaseUrl || !supabaseServiceKey) {
      return jsonErr("internal_error", "Server configuration error");
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
      console.error("[update-avatar] Session lookup failed:", sessionError);
      return jsonErr("unauthorized", "Invalid or expired session");
    }
    if (new Date(sessionData.expiresAt) < new Date()) {
      return jsonErr("unauthorized", "Session expired");
    }

    const authUserId = sessionData.userId;

    let body: { avatarUrl: string };
    try {
      body = await req.json();
    } catch {
      return jsonErr("validation_error", "Invalid JSON body");
    }

    const { avatarUrl } = body;
    if (!avatarUrl) return jsonErr("validation_error", "avatarUrl is required");

    console.log(
      "[update-avatar] User:",
      authUserId,
      "URL:",
      avatarUrl.substring(0, 60),
    );

    const userData = await resolveOrProvisionUser(
      supabaseAdmin,
      authUserId,
      "id",
    );
    if (!userData) return jsonErr("not_found", "User not found");

    // Create media record
    const { data: mediaData, error: mediaError } = await supabaseAdmin
      .from("media")
      .insert({ url: avatarUrl })
      .select("id")
      .single();

    if (mediaError) {
      console.error("[update-avatar] Media insert failed:", mediaError);
      return jsonErr("internal_error", "Failed to create media record");
    }

    // Update user avatar
    const { error: updateError } = await supabaseAdmin
      .from("users")
      .update({ avatar_id: mediaData.id })
      .eq("id", userData.id);

    if (updateError) {
      console.error("[update-avatar] User update failed:", updateError);
      return jsonErr("internal_error", "Failed to update avatar");
    }

    console.log(
      "[update-avatar] Success: user",
      userData.id,
      "avatar_id →",
      mediaData.id,
    );
    return jsonOk({ success: true, avatarUrl });
  } catch (err) {
    console.error("[update-avatar] Unexpected error:", err);
    return jsonErr("internal_error", "An unexpected error occurred");
  }
});
