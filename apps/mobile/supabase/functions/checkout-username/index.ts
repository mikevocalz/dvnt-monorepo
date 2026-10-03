/**
 * Edge Function: checkout-username
 *
 * Live availability for the username a guest picks at checkout.
 *
 *   POST { username } -> { ok: true, available: boolean, reason?: "invalid" | "taken" }
 *
 * It answers about the username only. It takes no email and never says
 * whether an email has an account, so it cannot be used to find out who
 * bought a ticket. Usernames are already public on every profile, so
 * "taken" leaks nothing new. Rate limited per IP; the answer is advisory and
 * ensure_checkout_profile re-checks when it creates the profile.
 *
 * Deno env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { checkUsername } from "../_shared/checkout-profile-fields.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, sentry-trace, baggage",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: { code: "method", message: "POST only." } }, 405);

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  // A person typing checks a handful of names; 40 a minute covers a slow
  // typist with debounce and stops a script walking the namespace.
  const rl = checkRateLimit(ip, "checkout-username", { maxRequests: 40, windowMs: 60_000 });
  if (!rl.allowed) {
    return json({ ok: false, error: { code: "rate_limited", message: "Too many checks. Wait a moment." } }, 429);
  }

  const body = await req.json().catch(() => ({}));
  const parsed = checkUsername(body?.username);
  if (!parsed.ok) {
    // Reserved names read as taken, so the brand list is not advertised.
    return json({
      ok: true,
      available: false,
      reason: parsed.code === "reserved_username" ? "taken" : "invalid",
      message: parsed.message,
    });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
      { auth: { persistSession: false } },
    );
    const { data, error } = await supabase.rpc("checkout_username_available", {
      p_username: parsed.value,
    });
    if (error) {
      console.error("[checkout-username] rpc failed:", error.message);
      return json({ ok: false, error: { code: "unavailable", message: "Couldn't check that name." } }, 503);
    }
    return data === true
      ? json({ ok: true, available: true })
      : json({ ok: true, available: false, reason: "taken", message: "That username is taken." });
  } catch (e) {
    console.error("[checkout-username]", e);
    return json({ ok: false, error: { code: "internal_error", message: "Couldn't check that name." } }, 500);
  }
});
