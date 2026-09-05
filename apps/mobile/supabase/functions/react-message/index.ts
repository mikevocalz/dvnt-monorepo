/**
 * Edge Function: react-message
 * Toggle emoji reaction on a message (stored in metadata JSONB)
 * Uses service_role to bypass RLS on messages table
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySessionDetailed } from "../_shared/verify-session.ts";
import { resolveOrProvisionUser } from "../_shared/resolve-user.ts";

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

function errorResponse(code: string, message: string): Response {
  console.error(`[Edge:react-message] Error: ${code} - ${message}`);
  return jsonResponse({ ok: false, error: { code, message } }, 200);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") return errorResponse("bad_request", "Method not allowed");

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return errorResponse("unauthorized", "Missing authorization token");
    }
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const supabaseAdmin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${serviceKey}` } },
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

    const { messageId, emoji, desiredPresent } = await req.json();
    if (!Number.isSafeInteger(messageId) || messageId <= 0 || typeof emoji !== "string" ||
        (desiredPresent !== undefined && typeof desiredPresent !== "boolean")) {
      return errorResponse("bad_request", "messageId and emoji are required");
    }

    // Look up the user's integer ID and username (auto-provision if needed)
    const userRow = await resolveOrProvisionUser(
      supabaseAdmin,
      authUserId,
      "id, username, auth_id",
    );
    if (!userRow) return errorResponse("not_found", "User not found");

    const { data: result, error } = await supabaseAdmin.rpc("set_message_reaction", {
      p_message_id: messageId,
      p_auth_id: authUserId,
      p_emoji: emoji,
      p_desired_present: desiredPresent ?? null,
    });
    if (error) return errorResponse("update_failed", "Could not update reaction");
    if (!result?.ok) return errorResponse(result?.code || "forbidden", "This message is unavailable");
    return jsonResponse({ ok: true, data: {
      reactions: result.reactions, toggled: result.toggled, present: result.present,
    } });
  } catch (err: any) {
    console.error("[Edge:react-message] Unexpected error:", err);
    return errorResponse("internal_error", "Could not update reaction");
  }
});
