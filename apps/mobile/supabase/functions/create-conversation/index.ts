/**
 * Edge Function: create-conversation
 * Create or get a direct conversation with Better Auth verification
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySessionDetailed } from "../_shared/verify-session.ts";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";
import { ensureDirectConversation } from "../_shared/conversation-delivery.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
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
      return errorResponse("unauthorized", "Invalid or expired session");
    }

    const authUserId = sessionResult.userId;

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

    // conversations_rels.users_id is TEXT (auth_id). The lookup/create and the
    // participant rows live in _shared/conversation-delivery.ts so the brand
    // outbox worker opens a DM on exactly the same rows this endpoint does.
    const conversation = await ensureDirectConversation(
      supabaseAdmin,
      myAuthId,
      otherAuthId,
    );
    if (!conversation.ok) {
      return errorResponse("internal_error", conversation.error, 500);
    }

    return jsonResponse({
      ok: true,
      data: {
        conversationId: String(conversation.conversationId),
        isNew: conversation.isNew,
      },
    });
  } catch (err) {
    console.error("[Edge:create-conversation] Error:", err);
    return errorResponse("internal_error", "An unexpected error occurred");
  }
});
