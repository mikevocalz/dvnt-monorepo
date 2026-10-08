/**
 * Authenticated Didit session creation for DVNT's adult verification.
 * Production: DIDIT_API_KEY and DIDIT_WORKFLOW_ID must be Supabase Edge secrets
 * on the SAME project the web/native client calls. This code never bypasses the
 * adult gate when configuration or provider health is unavailable.
 *
 * Didit v3: POST https://verification.didit.me/v3/session/
 * with x-api-key, workflow_id, vendor_data and optional callback.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, corsHeaders, optionsResponse } from "../_shared/verify-session.ts";
import { withSentry } from "../_shared/sentry.ts";
import { checkAdultBirthDate } from "../_shared/age-policy.ts";
import { normalizeVerificationState } from "../_shared/verification-state.ts";

const DIDIT_SESSION_URL = "https://verification.didit.me/v3/session/";
const PROVIDER_TIMEOUT_MS = 10_000;

function json(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders(req),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
      ...(status === 503 ? { "Retry-After": "60" } : {}),
    },
  });
}

function fail(req: Request, code: string, message: string, status: number): Response {
  // Stable code and HTTP status for monitoring; do not log user IDs, ID data or secrets.
  console.error(`[create-verification-session] ${code}`);
  return json(req, { ok: false, error: { code, message } }, status);
}

/** Only allow a return to a DVNT-controlled origin (or the native app scheme). */
function allowedCallback(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 2048) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol === "dvnt:") return url.toString();
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost")) return undefined;
    if (!["dvntapp.live", "www.dvntapp.live", "dvnt.app", "www.dvnt.app", "localhost"].includes(url.hostname)) return undefined;
    url.username = "";
    url.password = "";
    url.hash = "";
    return url.toString();
  } catch {
    return undefined;
  }
}

Deno.serve(withSentry("create-verification-session", async (req) => {
  if (req.method === "OPTIONS") return optionsResponse(req);
  if (req.method !== "POST") return fail(req, "method_not_allowed", "POST only", 405);

  const dbUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!dbUrl || !serviceKey) {
    return fail(req, "service_unavailable", "Verification is temporarily unavailable. Your account is saved; please retry later.", 503);
  }
  const supabase = createClient(dbUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const authUserId = await verifySession(supabase, req);
  if (!authUserId) return fail(req, "unauthorized", "Please sign in again to verify your account.", 401);

  // Approvals and non-retryable decisions do not depend on provider availability.
  const { data: existing, error: readError } = await supabase
    .from("identity_verifications")
    .select("status,provider_ref,date_of_birth,failure_code,failure_message")
    .eq("user_id", authUserId)
    .maybeSingle();
  if (readError) return fail(req, "status_unavailable", "Verification status could not be loaded. Please try again.", 503);
  if (existing?.status === "passed" && checkAdultBirthDate(existing.date_of_birth).allowed) {
    return json(req, { ok: true, data: { status: "passed" } });
  }
  const state = normalizeVerificationState(existing);
  if (state.state === "rejected" && !state.retryable) {
    return fail(req, state.reason || "verification_rejected",
      state.message || "This account cannot retry identity verification.", 403);
  }

  const apiKey = Deno.env.get("DIDIT_API_KEY");
  const workflowId = Deno.env.get("DIDIT_WORKFLOW_ID");
  if (!apiKey || !workflowId) {
    return fail(req, "not_configured",
      "ID verification is temporarily unavailable. Your DVNT account is saved. Please sign in and retry later.", 503);
  }

  const body = await req.json().catch(() => ({}));
  const callback = allowedCallback(body?.returnUrl);
  let response: Response;
  try {
    response = await fetch(DIDIT_SESSION_URL, {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow_id: workflowId,
        vendor_data: authUserId, // never accept a userId supplied by the caller
        ...(callback ? { callback } : {}),
      }),
      signal: AbortSignal.timeout(PROVIDER_TIMEOUT_MS),
    });
  } catch {
    return fail(req, "provider_unreachable", "ID verification is taking too long. Please retry.", 503);
  }
  if (!response.ok) {
    console.error(`[create-verification-session] provider_http_${response.status}`);
    return fail(req, "provider_unavailable", "ID verification could not start. Please retry shortly.", 503);
  }

  const session = await response.json().catch(() => null);
  const sessionId = typeof session?.session_id === "string" ? session.session_id : "";
  const url = typeof session?.url === "string" ? session.url : "";
  // Never return an arbitrary provider response as a redirect.
  let safeUrl: URL;
  try {
    safeUrl = new URL(url);
    if (safeUrl.protocol !== "https:" || !(safeUrl.hostname === "didit.me" || safeUrl.hostname.endsWith(".didit.me"))) {
      throw new Error("untrusted provider URL");
    }
  } catch {
    return fail(req, "provider_bad_response", "ID verification could not start. Please retry shortly.", 502);
  }
  if (!sessionId) return fail(req, "provider_bad_response", "ID verification could not start. Please retry shortly.", 502);

  // Do not advertise the session URL until the webhook correlation row is saved.
  const { error: saveError } = await supabase.from("identity_verifications").upsert({
    user_id: authUserId,
    provider: "didit",
    provider_ref: sessionId,
    status: "pending",
    last_event_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: "user_id" });
  if (saveError) {
    console.error("[create-verification-session] persistence_failed", saveError.code);
    return fail(req, "persistence_unavailable", "Could not save verification progress. Please retry.", 503);
  }
  return json(req, { ok: true, data: { status: "pending", url: safeUrl.toString(), sessionId } });
}));
