/** DRAFT, default off. Records independently reviewed completed payment evidence.
 * Does not initiate payments or fetch, trust, or fabricate provider receipts.
 * Event owners/co-organizers are NOT payment operators unless explicitly granted.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, corsHeaders, optionsResponse } from "../_shared/verify-session.ts";

const fields = ["request_key", "event_id", "promoter_id", "recipient_binding_id",
  "ledger_entry_ids", "amount_cents", "currency", "provider", "transaction_reference",
  "receipt_sha256", "receipt_reference", "evidence_status", "paid_at",
  "receipt_beneficiary_reference", "attestation"];
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
Deno.serve(async (req: Request) => {
  const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), {
    status, headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  if (Deno.env.get("EXTERNAL_PROMOTER_RECORDING_ENABLED") !== "true") return reply({ error: "recording_disabled" }, 503);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return reply({ error: "not_configured" }, 503);
  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const actor = await verifySession(db, req);
    if (!actor) return reply({ error: "unauthorized" }, 401);
    const permission = await db.rpc("settlement_external_operator_allowed", { p_actor: actor });
    if (permission.error || permission.data !== true) return reply({ error: "forbidden" }, 403);
    // No receipt body/PII uploads. Bounded structured reference + explicit manual
    // attestation only. A hash proves integrity, not that a provider paid anyone.
    if (Number(req.headers.get("Content-Length")) > 65536) return reply({ error: "request_too_large" }, 413);
    const raw = await req.text();
    if (raw.length > 65536) return reply({ error: "request_too_large" }, 413);
    let input: any;
    try { input = JSON.parse(raw); } catch { return reply({ error: "invalid_request" }, 400); }
    if (!input || typeof input !== "object" || Array.isArray(input)
      || Object.keys(input).some(k => !fields.includes(k)) || fields.some(k => !(k in input))
      || ![input.request_key, input.promoter_id, input.recipient_binding_id].every(v => typeof v === "string" && uuid.test(v))
      || !Number.isSafeInteger(input.event_id) || input.event_id <= 0
      || !Number.isSafeInteger(input.amount_cents) || input.amount_cents <= 0
      || !Array.isArray(input.ledger_entry_ids) || input.ledger_entry_ids.length < 1 || input.ledger_entry_ids.length > 1000
      || !input.ledger_entry_ids.every((v: unknown) => typeof v === "string" && uuid.test(v))) {
      return reply({ error: "invalid_request" }, 400);
    }
    const args: Record<string, unknown> = { p_actor: actor };
    for (const field of fields) args[`p_${field}`] = input[field];
    const result = await db.rpc("settlement_record_external_promoter_payment", args);
    if (result.error || result.data?.recorded !== true) return reply({ error: "recording_rejected_review_required" }, 409);
    return reply(result.data);
  } catch {
    // No receipt, provider details, request body or database error in logs/Sentry.
    return reply({ error: "recording_unavailable" }, 503);
  }
});
