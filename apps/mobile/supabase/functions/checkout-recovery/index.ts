import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";
import { sendResendEmail } from "../_shared/send-resend-email.ts";
import { RECOVERY_RESPONSE, RECOVERY_TOKEN, RECOVERY_ORDER, recoveryToken, recoveryHash, recoveryEmail } from "../_shared/checkout-recovery.ts";

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const allowedOrigin = !origin || ["https://dvntapp.live", "https://dvnt.app"].includes(origin);
  const headers = {
    "Content-Type": "application/json", "Cache-Control": "no-store", "Referrer-Policy": "no-referrer",
    ...(allowedOrigin ? { "Access-Control-Allow-Origin": origin || "https://dvntapp.live" } : {}),
    "Vary": "Origin", "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, apikey, x-client-info, x-auth-token",
  };
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers });
  if (!allowedOrigin) return reply({ error: "Recovery unavailable" }, 403);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return reply({ error: "Method not allowed" }, 405);
  // Both gates must be explicitly enabled. Disabled requests do not query data.
  if (Deno.env.get("GUEST_CHECKOUT_RECOVERY_ENABLED") !== "true" || Deno.env.get("CHECKOUT_REPLACEMENT_ENABLED") !== "true") return reply({ error: "Recovery unavailable" }, 503);
  const raw = await req.text();
  if (raw.length > 2048) return reply({ error: "Invalid request" }, 400);
  let body: Record<string, unknown>;
  try { body = JSON.parse(raw); } catch { return reply({ error: "Invalid request" }, 400); }
  if (!body || typeof body !== "object" || Array.isArray(body) || !["request", "exchange"].includes(String(body.action))) return reply({ error: "Invalid request" }, 400);
  const db = createClient(Deno.env.get("SUPABASE_URL") || "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "", { auth: { persistSession: false, autoRefreshToken: false } });
  // An authenticated buyer cannot act as a guest, even with a valid guest link.
  // Invalid/expired explicit credentials are not silently downgraded to guest.
  const auth = req.headers.get("Authorization") || "";
  const explicitAuth = !!req.headers.get("x-auth-token") || (!!auth && auth !== `Bearer ${Deno.env.get("SUPABASE_ANON_KEY") || ""}`);
  try {
    if (await verifySession(db, req) || explicitAuth) return reply({ error: "Use the original guest session" }, 403);
    // Gateway forwarding header is only a supplemental limiter. The original
    // address has its own atomic limit and cannot be bypassed by changing IPs.
    const ipHash = await recoveryHash("checkout-recovery-ip:" + (req.headers.get("x-forwarded-for")?.split(",")[0]?.trim().slice(0, 100) || "unknown"));
    if (body.action === "request") {
      if (Object.keys(body).some((key) => !["action", "order_id", "email"].includes(key))) return reply({ error: "Invalid request" }, 400);
      // Validate without revealing existence; delivery runs after the uniform response.
      const work = async () => {
        if (typeof body.order_id !== "string" || !RECOVERY_ORDER.test(body.order_id) || typeof body.email !== "string") return;
        const email = body.email.trim().toLowerCase();
        if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return;
        const token = recoveryToken();
        const content = recoveryEmail(token, Deno.env.get("CHECKOUT_RECOVERY_SITE_URL") || "https://dvntapp.live");
        const { data, error } = await db.rpc("settlement_guest_recovery_issue", { p_order_id: body.order_id, p_email: email,
          p_capability_hash: await recoveryHash(token), p_email_hash: await recoveryHash("checkout-recovery-email:" + email), p_ip_hash: ipHash });
        if (error || data?.issued !== true || typeof data.email !== "string" || typeof data.capability_id !== "string") return;
        // Recipient is the DB's original address, never the submitted address.
        await sendResendEmail({ to: data.email, ...content, idempotencyKey: `checkout-recovery/${data.capability_id}`, timeoutMs: 10000 });
      };
      // Do not log exceptions: provider responses can include private email/body.
      const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } }).EdgeRuntime;
      if (typeof runtime?.waitUntil === "function") runtime.waitUntil(work().catch(() => {}));
      return reply(RECOVERY_RESPONSE);
    }
    if (Object.keys(body).some((key) => !["action", "token"].includes(key)) || typeof body.token !== "string" || !RECOVERY_TOKEN.test(body.token)) return reply({ error: "Recovery link unavailable" }, 409);
    const session = recoveryToken();
    const { data, error } = await db.rpc("settlement_guest_recovery_exchange", { p_capability_hash: await recoveryHash(body.token), p_session_hash: await recoveryHash(session), p_ip_hash: ipHash });
    if (error || data?.ok !== true || typeof data.order_id !== "string" || !RECOVERY_ORDER.test(data.order_id) || !Number.isFinite(Date.parse(data.expires_at)) || Date.parse(data.expires_at) <= Date.now()) return reply({ error: "Recovery link unavailable" }, 409);
    return reply({ ok: true, order_id: data.order_id, recovery_session: session, expires_at: data.expires_at });
  } catch { return reply({ error: "Recovery unavailable" }, 503); }
});
