/**
 * create-verification-session — B3 deferred ID verification.
 *
 * Creates a Didit verification session for the AUTHENTICATED user. vendor_data
 * is the server-derived Better Auth user id (same I1 binding the didit-webhook
 * trusts) — never client-supplied, so a session can't be minted for someone else.
 *
 * Contract verified against docs.didit.me (Create Session, v2):
 *   POST https://verification.didit.me/v2/session/
 *   headers: x-api-key, Content-Type: application/json
 *   body:    { workflow_id, vendor_data, callback? }
 *   returns: { session_id, url, status, ... }
 *
 * Responses: { ok, data: { status: 'passed' } }                   — already verified
 *            { ok, data: { status: 'pending', url, sessionId } }  — open this URL
 * Deno env: DIDIT_API_KEY, DIDIT_WORKFLOW_ID (+ standard Supabase vars).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession, corsHeaders, optionsResponse } from "../_shared/verify-session.ts";
import { withSentry } from "../_shared/sentry.ts";

function json(req: Request, data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}
function err(req: Request, code: string, message: string): Response {
  console.error(`[create-verification-session] ${code}: ${message}`);
  return json(req, { ok: false, error: { code, message } });
}

Deno.serve(
  withSentry("create-verification-session", async (req) => {
    if (req.method === "OPTIONS") return optionsResponse(req);
    if (req.method !== "POST") return err(req, "method_not_allowed", "POST only");

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const authUserId = await verifySession(supabase, req);
    if (!authUserId) return err(req, "unauthorized", "Sign in to verify");

    const apiKey = Deno.env.get("DIDIT_API_KEY");
    const workflowId = Deno.env.get("DIDIT_WORKFLOW_ID");
    if (!apiKey || !workflowId) {
      return err(req, "not_configured", "Verification isn't available right now");
    }

    // Already approved → the user never sees the flow again (B3).
    const { data: existing } = await supabase
      .from("identity_verifications")
      .select("status, provider_ref")
      .eq("user_id", authUserId)
      .maybeSingle();
    // Table vocabulary (CHECK constraint): pending|submitted|passed|failed|expired|review.
    if (existing?.status === "passed") {
      return json(req, { ok: true, data: { status: "passed" } });
    }

    // Optional post-verification return URL (validated https or app scheme).
    let callback: string | undefined;
    try {
      const body = await req.json().catch(() => ({}));
      const cb = typeof body?.returnUrl === "string" ? body.returnUrl : "";
      if (/^(https:\/\/|dvnt:\/\/)/i.test(cb)) callback = cb;
    } catch { /* no body */ }

    const res = await fetch("https://verification.didit.me/v2/session/", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        workflow_id: workflowId,
        vendor_data: authUserId,
        ...(callback ? { callback } : {}),
      }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[create-verification-session] didit error", res.status, detail.slice(0, 300));
      return err(req, "vendor_error", "Couldn't start verification. Try again in a minute.");
    }
    const session = await res.json();
    const sessionId = String(session.session_id ?? "");
    const url = String(session.url ?? "");
    if (!sessionId || !url) {
      return err(req, "vendor_error", "Verification session came back incomplete");
    }

    // Track the pending session so the webhook's update has a row to land on.
    await supabase.from("identity_verifications").upsert(
      {
        user_id: authUserId,
        provider: "didit",
        status: "pending",
        provider_ref: sessionId,
        last_event_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );

    return json(req, { ok: true, data: { status: "pending", url, sessionId } });
  }),
);
