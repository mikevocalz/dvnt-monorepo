/**
 * Edge Function: submit-verification
 * Submits a host verification request. Derives auth_id from the Better
 * Auth session — closes V2-DB-05 spoofing risk where the underlying
 * `submit_verification_request(p_user_auth_id, p_reason, p_social_url)`
 * RPC accepted auth_id as a client-controlled parameter.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  corsHeaders,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { checkRateLimit, WRITE_LIMIT } from "../_shared/rate-limit.ts";

interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: { code: string; message: string };
}

function jsonResponse<T>(
  req: Request,
  data: ApiResponse<T>,
  status = 200,
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function errorResponse(
  req: Request,
  code: string,
  message: string,
  status = 200,
): Response {
  console.error(`[Edge:submit-verification] ${code}: ${message}`);
  return jsonResponse(req, { ok: false, error: { code, message } }, status);
}

const MAX_REASON_LEN = 2000;
const MAX_URL_LEN = 500;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") {
    return errorResponse(req, "validation_error", "Method not allowed", 405);
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseServiceKey) {
      return errorResponse(req, "internal_error", "Server misconfigured", 500);
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${supabaseServiceKey}` } },
    });

    const authUserId = await verifySession(supabase, req);
    if (!authUserId) {
      return errorResponse(req, "unauthorized", "Invalid or expired session");
    }

    const rl = checkRateLimit(authUserId, "submit-verification", {
      maxRequests: 5,
      windowMs: 60_000,
    });
    if (!rl.allowed) {
      return errorResponse(
        req,
        "rate_limited",
        "Too many requests. Try again shortly.",
      );
    }

    let body: { reason?: string | null; socialUrl?: string | null };
    try {
      body = await req.json();
    } catch {
      return errorResponse(req, "validation_error", "Invalid JSON body", 400);
    }

    const reason =
      typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim().slice(0, MAX_REASON_LEN)
        : null;
    const socialUrl =
      typeof body.socialUrl === "string" && body.socialUrl.trim()
        ? body.socialUrl.trim().slice(0, MAX_URL_LEN)
        : null;

    const { data, error } = await supabase.rpc("submit_verification_request", {
      p_user_auth_id: authUserId,
      p_reason: reason,
      p_social_url: socialUrl,
    });

    if (error) {
      console.error("[Edge:submit-verification] RPC error:", error);
      return errorResponse(req, "internal_error", "Failed to submit request");
    }

    return jsonResponse(req, { ok: true, data });
  } catch (e) {
    console.error("[Edge:submit-verification] Unexpected:", e);
    return errorResponse(req, "internal_error", "Unexpected server error", 500);
  }
});
