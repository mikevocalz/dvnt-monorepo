/** Self-only verification and legacy membership eligibility; no document details returned. */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, corsHeaders, optionsResponse } from "../_shared/verify-session.ts";
import { normalizeVerificationState } from "../_shared/verification-state.ts";
import { applyLegacyAdultAccess } from "../_shared/legacy-adult-access.ts";
import { withSentry } from "../_shared/sentry.ts";

function json(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json", "Cache-Control": "no-store" } });
}
Deno.serve(withSentry("verification-status", async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST") return json(req, { ok: false, error: { code: "method_not_allowed", message: "POST only" } }, 405);
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return json(req, { ok: false, error: { code: "service_unavailable", message: "Verification status unavailable" } }, 503);
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const userId = await verifySession(supabase, req);
  if (!userId) return json(req, { ok: false, error: { code: "unauthorized", message: "Please sign in again" } }, 401);
  const { data, error } = await supabase.from("identity_verifications")
    .select("user_id,status,date_of_birth,failure_code,failure_message,provider_ref")
    .eq("user_id", userId).maybeSingle();
  if (error || (data && data.user_id !== userId)) {
    console.error("[verification-status] status_read_failed", error?.code || "wrong_owner");
    return json(req, { ok: false, error: { code: "status_unavailable", message: "Could not check verification status" } }, 503);
  }
  const state = await applyLegacyAdultAccess(supabase, userId, normalizeVerificationState(data));
  return json(req, { ok: true, data: {
    // Preserve the actual provider status. An entitlement does not invent an ID pass.
    status: data?.status ?? "none", state: { ...state, providerRef: null },
  } });
}));
