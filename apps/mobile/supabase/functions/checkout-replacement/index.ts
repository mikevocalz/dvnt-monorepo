import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";
import { recoveryHash, RECOVERY_TOKEN } from "../_shared/checkout-recovery.ts";
import { runCheckoutReplacement, CheckoutReplacementError } from "../_shared/checkout-replacement.ts";

/** Default-off. No client may submit cancellation evidence or actor identity.
 * Do not log request bodies, errors, recovery sessions or provider responses.
 */
Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowed = !origin || ["https://dvntapp.live", "https://dvnt.app"].includes(origin);
  const headers = { "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    "Vary": "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, x-auth-token",
    ...(allowed ? { "Access-Control-Allow-Origin": origin || "https://dvntapp.live" } : {}) };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (!allowed) return reply({ code: "forbidden", error: "Checkout unavailable" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  if (Deno.env.get("CHECKOUT_REPLACEMENT_ENABLED") !== "true" || Deno.env.get("TICKET_SEPARATE_CHARGES_ENABLED") !== "true") {
    return reply({ code: "replacement_unavailable", error: "Checkout replacement is not available." }, 503);
  }
  try {
    const raw = await req.text();
    if (raw.length > 4096) return reply({ code: "invalid_request", error: "Invalid request" }, 400);
    let body: any; try { body = JSON.parse(raw); } catch { return reply({ code: "invalid_request", error: "Invalid request" }, 400); }
    if (!body || typeof body !== "object" || Array.isArray(body) ||
      !["quote", "accept"].includes(body.action) ||
      Object.keys(body).some(key => !["action", "order_id", "quote_id", "accepted_total_cents", "accepted_currency", "recovery_session"].includes(key))) {
      return reply({ code: "invalid_request", error: "Invalid request" }, 400);
    }
    const key = Deno.env.get("STRIPE_SECRET_KEY");
    const url = Deno.env.get("SUPABASE_URL"); const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!key || !url || !service) return reply({ code: "replacement_unavailable", error: "Checkout replacement is not configured." }, 503);
    const db = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } });
    const actorId = await verifySession(db, req);
    const authorization = req.headers.get("Authorization") || "";
    const explicitAuth = !!req.headers.get("x-auth-token") || (!!authorization && authorization !== `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`);
    const guest = typeof body.recovery_session === "string" && RECOVERY_TOKEN.test(body.recovery_session);
    if (actorId ? body.recovery_session != null : explicitAuth || !guest) {
      return reply({ code: "unauthorized", error: "Use the original buyer's session." }, 401);
    }
    const identity = { actorId, guestSessionHash: guest ? await recoveryHash(body.recovery_session) : null };
    const request = async (path: string, params?: Record<string, string>, idempotencyKey?: string) => {
      if (!/^\/v1\/(account$|payment_intents(?:\/|$)|checkout\/sessions(?:\/|$)|charges\?)/.test(path)) throw new Error("Unsupported provider path");
      const response = await fetch(`https://api.stripe.com${path}`, { method: params ? "POST" : "GET",
        headers: { Authorization: `Bearer ${key}`, "Stripe-Version": "2026-09-30.endive",
          ...(params ? { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": idempotencyKey! } : {}) },
        ...(params ? { body: new URLSearchParams(params) } : {}), signal: AbortSignal.timeout(30000) });
      const value = await response.json();
      if (!response.ok || value?.error) throw new Error("Provider outcome unverified");
      return value;
    };
    const provider = { get: (path: string) => request(path), post: (path: string, params: Record<string, string>, idempotencyKey: string) => request(path, params, idempotencyKey) };
    return reply(await runCheckoutReplacement(db, provider, body, identity, { publishableKey: Deno.env.get("STRIPE_PUBLISHABLE_KEY") }));
  } catch (error) {
    if (error instanceof CheckoutReplacementError) return reply({ code: error.code, error: error.message }, error.status);
    return reply({ code: "checkout_outcome_unverified", error: "We could not verify this checkout. Do not pay again; check the existing order or contact support." }, 409);
  }
});
