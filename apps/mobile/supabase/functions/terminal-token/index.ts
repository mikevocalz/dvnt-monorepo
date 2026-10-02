/**
 * terminal-token — Stripe Terminal connection tokens for Tap to Pay.
 *
 * POST { event_id }
 *   → { secret }            a scoped Terminal connection token
 *
 * Rules from the Phase 5 spec:
 *  - Authenticated via Better Auth session (x-auth-token / Bearer).
 *  - The caller is re-authorized for THE EVENT on every request —
 *    host or accepted scanner/editor/admin, same predicate as door-sell.
 *  - The token is scoped to the event's Terminal Location (platform-owned;
 *    under separate charges and transfers there is no Stripe-Account header
 *    and staff never collect into a personal account).
 *  - Tokens are minted per call: never cached, never hardcoded, short-lived.
 *  - No location mapping → 409 with an actionable error, not a fallback
 *    that silently collects unscoped.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";
import { canSellAtDoor } from "../_shared/door-sale.ts";
import { checkRateLimit } from "../_shared/rate-limit.ts";
import { withSentry } from "../_shared/sentry.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-auth-token, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...cors },
  });
}

Deno.serve(withSentry("terminal-token", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: cors });
  }
  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const staffUserId = await verifySession(supabase, req);
    if (!staffUserId) return json({ error: "Unauthorized" }, 401);

    const { event_id } = await req.json().catch(() => ({}));
    if (!event_id) return json({ error: "Missing event_id" }, 400);
    const eventId = parseInt(event_id);

    const rl = checkRateLimit(`terminal:${staffUserId}`, "terminal-token", {
      maxRequests: 20,
      windowMs: 10 * 60_000,
    });
    if (!rl.allowed) {
      return json(
        { error: "Too many token requests. Try again shortly." },
        429,
      );
    }

    // Same event-scoped authorization as a door sale.
    const { data: event } = await supabase
      .from("events")
      .select("host_id")
      .eq("id", eventId)
      .single();
    if (!event?.host_id) return json({ error: "Event not found" }, 404);

    const isHost = String(event.host_id) === String(staffUserId);
    let staffRole: string | null = isHost ? "owner" : null;
    if (!isHost) {
      const { data: coOrg } = await supabase
        .from("event_co_organizers")
        .select("role")
        .eq("event_id", eventId)
        .eq("user_id", staffUserId)
        .eq("accepted", true)
        .in("role", ["scanner", "editor", "admin"])
        .maybeSingle();
      staffRole = coOrg?.role ?? null;
    }
    if (!canSellAtDoor(isHost, staffRole)) {
      return json({ error: "Your access to this event ended." }, 403);
    }

    // The event must have a configured platform Location.
    const { data: loc } = await supabase
      .from("event_terminal_locations")
      .select("stripe_location_id")
      .eq("event_id", eventId)
      .maybeSingle();
    if (!loc?.stripe_location_id) {
      return json({
        error:
          "Tap to Pay is not configured for this event. Use web Sell instead.",
        code: "no_terminal_location",
      }, 409);
    }

    if (!STRIPE_SECRET_KEY) {
      return json({ error: "Payments are not configured" }, 500);
    }

    // Mint a scoped connection token — platform account, no Stripe-Account
    // header (separate charges and transfers).
    const res = await fetch("https://api.stripe.com/v1/terminal/connection_tokens", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ location: loc.stripe_location_id }),
    });
    const token = await res.json();
    if (!res.ok || !token.secret) {
      console.error("[terminal-token] Stripe error:", token);
      return json({ error: "Could not start Tap to Pay. Try again." }, 502);
    }
    return json({ secret: token.secret });
  } catch (err: any) {
    console.error("[terminal-token] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
}));
