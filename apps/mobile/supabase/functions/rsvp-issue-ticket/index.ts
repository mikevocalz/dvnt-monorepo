/**
 * Edge Function: rsvp-issue-ticket
 * Issues a free-RSVP ticket for an event. Derives the caller's auth_id
 * from the Better Auth session — closes V2-DB-05 spoofing risk where
 * the underlying `issue_rsvp_ticket(p_event_id, p_user_auth_id)` RPC
 * accepted the auth_id as a client-controlled parameter.
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
  console.error(`[Edge:rsvp-issue-ticket] ${code}: ${message}`);
  return jsonResponse(req, { ok: false, error: { code, message } }, status);
}

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

    const rl = checkRateLimit(authUserId, "rsvp-issue-ticket", WRITE_LIMIT);
    if (!rl.allowed) {
      return errorResponse(
        req,
        "rate_limited",
        "Too many requests. Try again shortly.",
      );
    }

    let body: { eventId?: number | string };
    try {
      body = await req.json();
    } catch {
      return errorResponse(req, "validation_error", "Invalid JSON body", 400);
    }

    const eventIdInt =
      typeof body.eventId === "number"
        ? body.eventId
        : parseInt(String(body.eventId ?? ""), 10);
    if (!Number.isFinite(eventIdInt) || eventIdInt <= 0) {
      return errorResponse(
        req,
        "validation_error",
        "eventId is required and must be a positive integer",
        400,
      );
    }

    // CRITICAL: refuse to issue a free RSVP ticket when the event has
    // ticketing enabled. Otherwise a buyer who reaches this endpoint
    // (e.g. via a misconfigured client falling through to the legacy
    // RSVP path, or a malicious direct hit) gets a free ticket on an
    // event that's supposed to charge. Paid events MUST go through
    // create-payment-intent → Stripe.
    const { data: ev, error: evErr } = await supabase
      .from("events")
      .select("ticketing_enabled, status")
      .eq("id", eventIdInt)
      .maybeSingle();
    if (evErr) {
      console.error("[Edge:rsvp-issue-ticket] event lookup error:", evErr);
      return errorResponse(req, "internal_error", "Failed to load event");
    }
    if (!ev) {
      return errorResponse(req, "not_found", "Event not found", 404);
    }
    if (ev.status !== "active") {
      return errorResponse(
        req,
        "validation_error",
        "Event is not active",
        400,
      );
    }
    if (ev.ticketing_enabled) {
      return errorResponse(
        req,
        "ticketing_enabled",
        "This event requires a paid ticket. Use the ticket checkout flow.",
        400,
      );
    }

    const { data, error } = await supabase.rpc("issue_rsvp_ticket", {
      p_event_id: eventIdInt,
      p_user_auth_id: authUserId,
    });

    if (error) {
      console.error("[Edge:rsvp-issue-ticket] RPC error:", error);
      return errorResponse(req, "internal_error", "Failed to issue ticket");
    }

    return jsonResponse(req, { ok: true, data });
  } catch (e) {
    console.error("[Edge:rsvp-issue-ticket] Unexpected:", e);
    return errorResponse(req, "internal_error", "Unexpected server error", 500);
  }
});
