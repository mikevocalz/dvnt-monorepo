import { deliverTicketReceipts } from "../_shared/ticket-receipt-delivery.ts";
/**
 * claim-comp-ticket Edge Function
 *
 * POST /claim-comp-ticket
 * Body: { token: string }   // from the /ticket/claim/<token> link a host texted
 *
 * Binds a phone comp to the signed-in account. Better Auth session required:
 * the claim is what turns "whoever has this text" into a named ticket holder.
 *
 * Existing age and restricted-profile checks run before the claim. Claiming
 * a ticket does not require the social profile photo/first-post sequence.
 * A refused account keeps the link: the token is not burned until a claim
 * succeeds, so the person can verify and come back.
 *
 * claim_comp_ticket (service_role only) does the atomic part: single use,
 * idempotent for the same account, refused for any other, refused after
 * expiry.
 *
 * Returns:
 *   200 { ok: true, data: { ticket_id, event_id, already_claimed } }
 *   4xx { ok: false, error: <message>, code }
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
  // `error` is the message string: the client's invokeEdge surfaces a string
  // `error` as-is, and the status already says which refusal it was.
  return json({ ok: false, error: message, code }, status, req);
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

    const admission = await resolveVerifiedAdmission(supabase, userId, new Date(), { purpose: "ticket_claim" });
    if (admission.state === "blocked") {
      const r = admissionRefusal(admission);
      return refuse(403, r.code, r.message, req);
    }

    const { data, error } = await supabase.rpc("claim_comp_ticket_with_receipt", {
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

    // A phone ticket gets an email only after a verified account claims it.
    // Atomic claim enqueues the receipt once; replay cannot create another.
    try {
      await deliverTicketReceipts(supabase, data.receipt_ids || []);
    } catch {
      console.warn("[claim-comp-ticket] receipt processing pending");
    }

    // Only the winning claim emits activity. A replay must not add duplicate
    // rows, and a notification outage must not turn a committed claim into a
    // failed ticket response. The claimant's canonical profile owns the feed;
    // neither a phone number nor the bearer claim token identifies a feed.
    if (data.already_claimed !== true) {
      try {
        const { data: recipient, error: recipientError } = await supabase
          .from("users").select("id").eq("auth_id", userId).maybeSingle();
        if (recipientError || !recipient?.id) {
          console.warn("[claim-comp-ticket] notification recipient unavailable:", recipientError?.code || "profile_missing");
        } else {
          // Attribute the original issuer, not the claimant or an assumed host.
          const { data: claimLink, error: linkError } = await supabase.from("ticket_claim_links")
            .select("issued_by").eq("ticket_id", data.ticket_id)
            .eq("claimed_by", userId).maybeSingle();
          const { data: issuer, error: issuerError } = !linkError && claimLink?.issued_by
            ? await supabase.from("users").select("id")
              .eq("auth_id", claimLink.issued_by).maybeSingle()
            : { data: null, error: null };
          const { error: notificationError } = await supabase.from("notifications").insert({
            recipient_id: recipient.id,
            actor_id: issuerError ? null : issuer?.id ?? null,
            type: "ticket_comped",
            entity_type: "event",
            entity_id: String(data.event_id),
            entity_payload: { ticket_id: data.ticket_id },
          });
          if (notificationError) console.warn("[claim-comp-ticket] notification insert failed:", notificationError.code || "insert_failed");
        }
      } catch {
        console.warn("[claim-comp-ticket] notification unavailable");
      }
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

