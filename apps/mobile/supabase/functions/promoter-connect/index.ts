/**
 * Promoter Connect Edge Function (Phase 3)
 *
 * POST /promoter-connect
 *   { action: "start" | "status", event_id, promoter_id? }
 *
 * Lets a linked promoter connect their bank account via Stripe Express so
 * they can receive commission payouts. Reuses an existing organizer
 * account if the same DVNT user is already an organizer.
 *
 * Actions:
 *   - start: create/link a Stripe Express account and return onboarding URL
 *   - status: return current account onboarding status from Stripe
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const FUNCTION_BASE = `${SUPABASE_URL}/functions/v1/promoter-connect`;

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[promoter-connect] FATAL: STRIPE_SECRET_KEY env var is not set.",
  );
}

async function stripeRequest(
  endpoint: string,
  body: Record<string, string>,
): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams(body).toString(),
  });
  const data = await res.json();
  if (data.error) {
    console.error(
      "[promoter-connect] Stripe API error:",
      JSON.stringify(data.error),
    );
    throw new Error(data.error.message);
  }
  return data;
}

async function stripeGet(endpoint: string): Promise<any> {
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    headers: { Authorization: `Bearer ${STRIPE_SECRET_KEY}` },
  });
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "POST, OPTIONS",
        "Access-Control-Allow-Headers":
          "Content-Type, Authorization, apikey, x-client-info, x-auth-token, sentry-trace, baggage",
      },
    });
  }

  if (req.method === "GET") {
    const url = new URL(req.url);
    const callback = url.searchParams.get("callback");
    if (callback === "return") {
      return new Response(null, {
        status: 302,
        headers: { Location: "dvnt://stripe/connect/success" },
      });
    }
    if (callback === "refresh") {
      return new Response(null, {
        status: 302,
        headers: { Location: "dvnt://stripe/connect/refresh" },
      });
    }
    return new Response("Not found", { status: 404 });
  }

  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  if (!STRIPE_SECRET_KEY) {
    return json(
      {
        error:
          "Stripe is not configured for this environment. Contact support.",
      },
      503,
    );
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const userId = await verifySession(supabase, req);
    if (!userId) {
      return json({ error: "Unauthorized — invalid or expired session" }, 401);
    }

    const body = await req.json();
    const eventId = Number(body.event_id);
    const promoterId =
      typeof body.promoter_id === "string" ? body.promoter_id : null;

    if (!Number.isFinite(eventId) || eventId <= 0) {
      return json({ error: "event_id required" }, 400);
    }

    // Locate the promoter row. If promoter_id is provided, the caller must be
    // that promoter (or the event owner). If not, find by linked user_id.
    let promoterQuery = supabase
      .from("event_promoters")
      .select("id, user_id, display_name, stripe_account_id")
      .eq("event_id", eventId);

    if (promoterId) {
      promoterQuery = promoterQuery.eq("id", promoterId);
    } else {
      promoterQuery = promoterQuery.eq("user_id", userId);
    }

    const { data: promoter, error: promoterErr } = await promoterQuery
      .neq("status", "removed")
      .maybeSingle();

    if (promoterErr) {
      console.error("[promoter-connect] promoter lookup error:", promoterErr);
      return json({ error: "Could not load promoter record" }, 500);
    }
    if (!promoter) {
      return json(
        { error: "Promoter not found for this event" },
        404,
      );
    }

    // Authorization: the user must be the linked promoter. External promoters
    // (user_id IS NULL) cannot onboard electronically; they need a DVNT
    // account first.
    if (!promoter.user_id || promoter.user_id !== userId) {
      return json(
        { error: "Only the linked promoter can onboard payouts" },
        403,
      );
    }

    const action = String(body.action || "");

    if (action === "start") {
      // Reuse an existing organizer account for the same identity.
      const { data: organizerAccount } = await supabase
        .from("organizer_accounts")
        .select("stripe_account_id")
        .eq("host_id", userId)
        .maybeSingle();

      let stripeAccountId = promoter.stripe_account_id ??
        organizerAccount?.stripe_account_id ?? null;

      if (!stripeAccountId) {
        const account = await stripeRequest("/accounts", {
          type: "express",
          "capabilities[transfers][requested]": "true",
          "metadata[dvnt_user_id]": userId,
          "metadata[dvnt_promoter_id]": promoter.id,
          "metadata[dvnt_event_id]": String(eventId),
        });
        stripeAccountId = account.id;
        console.log(
          "[promoter-connect] Stripe account created:",
          stripeAccountId,
        );
      }

      // Store the link on the promoter row. If the row already has an account
      // id (e.g. from a prior race), keep it.
      const { error: upsertErr } = await supabase
        .from("event_promoters")
        .update({
          stripe_account_id: stripeAccountId,
          updated_at: new Date().toISOString(),
        })
        .eq("id", promoter.id);

      if (upsertErr) {
        console.error("[promoter-connect] DB update error:", upsertErr);
        return json({ error: "Could not save promoter account" }, 500);
      }

      const link = await stripeRequest("/account_links", {
        account: stripeAccountId,
        refresh_url: `${FUNCTION_BASE}?callback=refresh`,
        return_url: `${FUNCTION_BASE}?callback=return`,
        type: "account_onboarding",
      });

      if (
        !link.url || typeof link.url !== "string" ||
        !link.url.startsWith("https://")
      ) {
        console.error("[promoter-connect] Invalid URL from Stripe:", link.url);
        return json({ error: "Stripe returned an invalid onboarding URL" });
      }

      return json({ url: link.url, account_id: stripeAccountId });
    }

    if (action === "status") {
      if (!promoter.stripe_account_id) {
        return json({ connected: false });
      }

      const stripeAccount = await stripeGet(
        `/accounts/${promoter.stripe_account_id}`,
      );

      await supabase
        .from("event_promoters")
        .update({
          charges_enabled: stripeAccount.charges_enabled,
          payouts_enabled: stripeAccount.payouts_enabled,
          details_submitted: stripeAccount.details_submitted,
          updated_at: new Date().toISOString(),
        })
        .eq("id", promoter.id);

      const reqs = stripeAccount.requirements || {};
      return json({
        connected: true,
        charges_enabled: stripeAccount.charges_enabled,
        payouts_enabled: stripeAccount.payouts_enabled,
        details_submitted: stripeAccount.details_submitted,
        stripe_account_id: promoter.stripe_account_id,
        currently_due: reqs.currently_due || [],
        pending_verification: reqs.pending_verification || [],
        past_due: reqs.past_due || [],
        disabled_reason: reqs.disabled_reason || null,
        capabilities: stripeAccount.capabilities || {},
      });
    }

    return json({ error: "Invalid action" }, 400);
  } catch (err: any) {
    console.error("[promoter-connect] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
});
