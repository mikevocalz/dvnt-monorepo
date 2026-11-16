/** Actor-owned external status only; no provider receipt or reference is exposed. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { corsHeaders, optionsResponse } from "../_shared/verify-session.ts";
import { verifyExternalPaymentSession, readExternalPaymentBody } from "../_shared/external-payment-session.ts";
Deno.serve(async (req: Request) => {
  const reply = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
    status, headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return reply({ error: "method_not_allowed" }, 405);
  if (Deno.env.get("EXTERNAL_PROMOTER_STATUS_ENABLED") !== "true") return reply({ error: "status_disabled" }, 503);
  const url = Deno.env.get("SUPABASE_URL"), key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return reply({ error: "not_configured" }, 503);
  try {
    const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
    const session = await verifyExternalPaymentSession(db, req);
    const actor = session?.actor;
    if (!actor || !session) return reply({ error: "unauthorized" }, 401);
    const raw = await readExternalPaymentBody(req, 1024);
    if (raw === null) return reply({ error: "request_too_large" }, 413);
    let body: any; try { body = JSON.parse(raw); } catch { return reply({ error: "invalid_request" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(k => k !== "event_id")
      || !Number.isSafeInteger(body.event_id) || body.event_id <= 0) return reply({ error: "invalid_request" }, 400);
    const result = await db.rpc("settlement_external_actor_status_session", { p_actor: actor, p_session_id: session.id, p_event_id: body.event_id });
    if (result.error || !result.data) return reply({ error: "status_unavailable" }, 503);
    return reply(result.data);
  } catch { return reply({ error: "status_unavailable" }, 503); }
});
