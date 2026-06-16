/**
 * Edge Function: create-conversation
 * Create or get a direct conversation with Better Auth verification
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

function errorResponse(code: string, message: string, status = 400): Response {
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

    let body: { otherUserId?: number; otherAuthId?: string };
    try {
      body = await req.json();
    } catch {
      return errorResponse("validation_error", "Invalid JSON body");
    }

    const { otherUserId, otherAuthId: otherAuthIdParam } = body;
    if (!otherUserId && !otherAuthIdParam)
      return errorResponse(
        "validation_error",
        "otherUserId or otherAuthId is required",
      );

    // Get current user's auth_id
    const myAuthId = authUserId;

    // Resolve the other user's auth_id
    let otherAuthId: string;
    if (otherAuthIdParam) {
      // Ensure the user exists (auto-provision if needed)
      const otherData = await resolveOrProvisionUser(
        supabaseAdmin,
        otherAuthIdParam,
        "id, auth_id",
      );
      if (!otherData) return errorResponse("not_found", "Other user not found");
      otherAuthId = otherAuthIdParam;
    } else {
      // Get other user's auth_id from their integer ID
      const { data: otherUser } = await supabaseAdmin
        .from("users")
        .select("auth_id")
        .eq("id", otherUserId)
        .single();

      if (!otherUser?.auth_id)
        return errorResponse("not_found", "Other user not found");
      otherAuthId = otherUser.auth_id;
    }

    // Check if conversation exists
    // conversations_rels.users_id is TEXT (auth_id)
    const { data: userConvs } = await supabaseAdmin
      .from("conversations_rels")
      .select("parent_id")
      .eq("users_id", myAuthId);

    const { data: otherConvs } = await supabaseAdmin
      .from("conversations_rels")
      .select("parent_id")
      .eq("users_id", otherAuthId);

    const userConvIds = (userConvs || []).map((c: any) => c.parent_id);
    const otherConvIds = (otherConvs || []).map((c: any) => c.parent_id);
    const commonConvIds = userConvIds.filter((id: number) =>
      otherConvIds.includes(id),
    );

    // Check if any common conversation is a direct (non-group) conversation
    for (const convId of commonConvIds) {
      const { data: conv } = await supabaseAdmin
        .from("conversations")
        .select("id, is_group")
        .eq("id", convId)
        .single();

      if (conv && !conv.is_group) {
        // CRITICAL: Verify this conversation actually has BOTH participants
        // (prevents returning orphaned conversations with no participants)
        const { data: participants } = await supabaseAdmin
          .from("conversations_rels")
          .select("users_id")
          .eq("parent_id", conv.id)
          .eq("path", "participants");

        const participantIds = (participants || []).map((p: any) => p.users_id);
        const hasBothParticipants =
          participantIds.includes(myAuthId) &&
          participantIds.includes(otherAuthId);

        if (hasBothParticipants) {
          return jsonResponse({
            ok: true,
            data: { conversationId: String(conv.id), isNew: false },
          });
        }
        // If participants are missing, skip this orphaned conversation and continue
        console.log(
          `[Edge:create-conversation] Skipping orphaned conversation ${conv.id}`,
        );
      }
    }

    // Create new conversation
    const { data: newConv, error: convError } = await supabaseAdmin
      .from("conversations")
      .insert({ is_group: false, last_message_at: new Date().toISOString() })
      .select()
      .single();

    if (convError)
      return errorResponse(
        "internal_error",
        "Failed to create conversation",
        500,
      );

    // Add participants (users_id is TEXT/auth_id)
    const { error: participantsError } = await supabaseAdmin
      .from("conversations_rels")
      .insert([
        { parent_id: newConv.id, users_id: myAuthId, path: "participants" },
        { parent_id: newConv.id, users_id: otherAuthId, path: "participants" },
      ]);

    if (participantsError) {
      console.error(
        "[Edge:create-conversation] Failed to add participants:",
        participantsError,
      );
      // Rollback: delete the conversation we just created
      await supabaseAdmin.from("conversations").delete().eq("id", newConv.id);
      return errorResponse(
        "internal_error",
        "Failed to add participants to conversation",
        500,
      );
    }

    return jsonResponse({
      ok: true,
      data: { conversationId: String(newConv.id), isNew: true },
    });
  } catch (err) {
    console.error("[Edge:create-conversation] Error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
