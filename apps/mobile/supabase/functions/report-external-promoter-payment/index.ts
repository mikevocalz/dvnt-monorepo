/** DRAFT, default off. Reports an external payment for durable quarantine, without marking it paid.
 * Does not initiate payments or fetch, trust, or fabricate provider receipts.
 * Event owners/co-organizers are NOT payment operators unless explicitly granted.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, optionsResponse } from "../_shared/verify-session.ts";

import { verifyExternalPaymentSession, readExternalPaymentBody } from "../_shared/external-payment-session.ts";

const fields = ["request_key", "event_id", "promoter_id", "report_reference"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async (req: Request) => {
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  if (Deno.env.get("EXTERNAL_PROMOTER_REPORTING_ENABLED") !== "true") return reply({ error: "reporting_disabled" }, 503);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return reply({ error: "not_configured" }, 503);
  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const session = await verifyExternalPaymentSession(db, req);
    const actor = session?.actor;
    if (!actor || !session) return reply({ error: "unauthorized" }, 401);
    const permission = await db.rpc("settlement_external_operator_allowed", { p_actor: actor, p_session_id: session.id });
    if (permission.error || permission.data !== true) return reply({ error: "forbidden" }, 403);
    // No receipt body/PII uploads. Bounded structured reference + explicit manual
    // attestation only. A hash proves integrity, not that a provider paid anyone.
    const raw = await readExternalPaymentBody(req, 8192);
    if (raw === null) return reply({ error: "request_too_large" }, 413);
    let input: any;
    try { input = JSON.parse(raw); } catch { return reply({ error: "invalid_request" }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some(k => !fields.includes(k)) || fields.some(k => !(k in input))
      || ![input.request_key, input.promoter_id].every(v => typeof v === "string" && uuid.test(v))
      || !Number.isSafeInteger(input.event_id) || input.event_id <= 0
      || typeof input.report_reference !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(input.report_reference)) {
      return reply({ error: "invalid_request" }, 400);
    }
    const args: Record<string, unknown> = { p_actor: actor, p_session_id: session.id };
    for (const field of fields) args[`p_${field}`] = input[field];
    const result = await db.rpc("settlement_report_external_payment_session", args);
    if (result.error || result.data?.quarantined !== true) return reply({ error: "quarantine_rejected_review_required" }, 409);
    return reply(result.data);
  } catch {
    // No receipt, provider details, request body or database error in logs/Sentry.
    return reply({ error: "quarantine_unavailable" }, 503);
  }
});
