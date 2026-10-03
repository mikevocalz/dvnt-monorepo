/**
 * claim-comp-ticket Edge Function
 *
 * POST /claim-comp-ticket
 * Body: { token: string }   // from the /ticket/claim/<token> link a host texted
 *
 * Binds a phone comp to the signed-in account. Better Auth session required:
 * the claim is what turns "whoever has this text" into a named ticket holder.
 *
 * The verified-admission gate runs before the claim, the same check
 * ticket-checkout runs for a signed-in buyer, so a comp cannot be used to get
 * a ticket the account could not buy. A refused account keeps the link: the
 * token is not burned until a claim succeeds, so the person can verify and
 * come back.
 *
 * claim_comp_ticket (service_role only) does the atomic part: single use,
 * idempotent for the same account, refused for any other, refused after
 * expiry.
 *
 * Returns:
 *   200 { ok: true, data: { ticket_id, event_id, already_claimed } }
 *   4xx { ok: false, error: { code, message } }
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  corsHeaders,
  optionsResponse,
} from "../_shared/verify-session.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { admissionRefusal, resolveVerifiedAdmission } from "../_shared/verified-admission.ts";
import { claimRefusal, isClaimToken } from "../_shared/comp-claim-links.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function json(data: unknown, status: number, req: Request) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

function refuse(status: number, code: string, message: string, req: Request) {
  return json({ ok: false, error: { code, message } }, status, req);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return refuse(405, "method_not_allowed", "Method not allowed", req);

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const userId = await verifySession(supabase, req);
    if (!userId) {
      const r = claimRefusal("unauthenticated");
      return refuse(r.status, r.code, r.message, req);
    }

    let body: { token?: unknown } = {};
    try {
      body = await req.json();
    } catch {
      return refuse(400, "invalid_body", "Invalid JSON body", req);
    }
    if (!isClaimToken(body.token)) {
      const r = claimRefusal("invalid_token");
      return refuse(r.status, r.code, r.message, req);
    }

    // Guessing is hopeless against a 256-bit token, but a tight per-account
    // cap keeps a script from trying.
    const rl = checkRateLimit(userId, "claim-comp-ticket", { maxRequests: 10, windowMs: 60_000 });
    if (!rl.allowed) {
      return refuse(429, "rate_limited", "Too many attempts. Wait a minute and try again.", req);
    }

    const admission = await resolveVerifiedAdmission(supabase, userId);
    if (admission.state === "blocked") {
      const r = admissionRefusal(admission);
      return refuse(403, r.code, r.message, req);
    }

    const { data, error } = await supabase.rpc("claim_comp_ticket", {
      p_token: body.token,
      p_user_id: userId,
    });
    if (error) {
      console.error("[claim-comp-ticket] rpc failed:", error.code);
      return refuse(500, "claim_failed", "Could not claim this ticket. Try again.", req);
    }
    if (!data?.ok) {
      const r = claimRefusal(data?.code);
      return refuse(r.status, r.code, r.message, req);
    }

    return json({
      ok: true,
      data: {
        ticket_id: data.ticket_id,
        event_id: data.event_id,
        already_claimed: data.already_claimed === true,
      },
    }, 200, req);
  } catch (e: any) {
    console.error("[claim-comp-ticket] unexpected:", e?.name || "error");
    return refuse(500, "claim_failed", "Could not claim this ticket. Try again.", req);
  }
});
