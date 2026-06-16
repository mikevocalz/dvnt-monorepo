/**
 * Organizer Connect Edge Function
 *
 * POST /organizer-connect  { action: "start" | "status", host_id }
 *
 * - "start": Create Stripe Express account + return onboarding link
 * - "status": Retrieve + sync account status
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";

const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
// HTTPS base URL for Stripe return/refresh callbacks (custom schemes are rejected)
const FUNCTION_BASE = `${SUPABASE_URL}/functions/v1/organizer-connect`;

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[organizer-connect] FATAL: STRIPE_SECRET_KEY env var is not set.",
  );
}

// ── Stripe helpers ──────────────────────────────────────────

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
      "[organizer-connect] Stripe API error:",
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

// ── Callback HTML pages (served on GET for Stripe redirects) ─


// ── JSON response helper ────────────────────────────────────

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
          "Content-Type, Authorization, apikey, x-client-info, x-auth-token",
      },
    });
  }

  // ── GET: Stripe callback landing pages ────────────────────
  if (req.method === "GET") {
    // Supabase edge runtime forces text/plain on GET responses and adds
    // CSP: default-src 'none'; sandbox — HTML can never render here.
    // Redirect to the app's custom scheme instead; openAuthSessionAsync
    // in the client catches the dvnt:// redirect and closes the browser.
    const url = new URL(req.url);
    const callback = url.searchParams.get("callback");
    if (callback === "return") {
      return new Response(null, {
        status: 302,
        headers: { Location: "dvnt://stripe/connect/success" },
      });
    }
    if (callback === "refresh") {
      // Link expired — redirect back to the app so the user can retry
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

    // ── Session auth (mandatory) ──────────────────────────
    const host_id = await verifySession(supabase, req);
    if (!host_id) {
      return new Response(
        JSON.stringify({ error: "Unauthorized — invalid or expired session" }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const { action } = await req.json();

    if (action === "start") {
      // Step 1: Check if account already exists
      console.log(
        "[organizer-connect] start: checking existing account for",
        host_id,
      );
      const { data: existing, error: dbErr } = await supabase
        .from("organizer_accounts")
        .select("stripe_account_id")
        .eq("host_id", host_id)
        .maybeSingle();

      if (dbErr && dbErr.code !== "PGRST116") {
        console.error("[organizer-connect] DB lookup error:", dbErr);
      }

      let stripeAccountId = existing?.stripe_account_id;

      if (!stripeAccountId) {
        // Step 2: Create new Express account
        console.log("[organizer-connect] creating Stripe Express account");
        const account = await stripeRequest("/accounts", {
          type: "express",
          "capabilities[card_payments][requested]": "true",
          "capabilities[transfers][requested]": "true",
          "metadata[dvnt_host_id]": host_id,
        });
        stripeAccountId = account.id;
        console.log(
          "[organizer-connect] Stripe account created:",
          stripeAccountId,
        );

        // Step 3: Save to DB
        // Don't ignoreDuplicates — when a row exists with NULL stripe_account_id
        // (e.g. after a test→live mode re-onboarding), we MUST overwrite it,
        // not skip. Otherwise webhook account.updated has nothing to match by.
        const { error: upsertErr } = await supabase
          .from("organizer_accounts")
          .upsert(
            {
              host_id,
              stripe_account_id: stripeAccountId,
              updated_at: new Date().toISOString(),
            },
            { onConflict: "host_id" },
          );
        if (upsertErr) {
          console.error("[organizer-connect] DB upsert error:", upsertErr);
        }

        // Re-read in case another request won the race
        const { data: recheck } = await supabase
          .from("organizer_accounts")
          .select("stripe_account_id")
          .eq("host_id", host_id)
          .maybeSingle();
        if (recheck?.stripe_account_id) {
          stripeAccountId = recheck.stripe_account_id;
        }
      }

      // Step 4: Create onboarding link
      console.log(
        "[organizer-connect] creating account link for",
        stripeAccountId,
      );
      const link = await stripeRequest("/account_links", {
        account: stripeAccountId,
        refresh_url: `${FUNCTION_BASE}?callback=refresh`,
        return_url: `${FUNCTION_BASE}?callback=return`,
        type: "account_onboarding",
      });

      console.log(
        "[organizer-connect] account link created, url prefix:",
        typeof link.url === "string"
          ? link.url.substring(0, 50)
          : String(link.url),
      );

      if (
        !link.url ||
        typeof link.url !== "string" ||
        !link.url.startsWith("https://")
      ) {
        console.error("[organizer-connect] Invalid URL from Stripe:", link.url);
        return json({ error: "Stripe returned an invalid onboarding URL" });
      }

      return json({ url: link.url, account_id: stripeAccountId });
    }

    // "update": create an account_onboarding link for restricted/re-verification flow.
    // Use this (NOT "start") when the account already exists but needs to satisfy
    // Stripe's currently_due requirements (charges or payouts disabled).
    // Note: account_update is only valid for fully-onboarded accounts; use
    // account_onboarding which Stripe accepts for all account states.
    if (action === "update") {
      const { data: account } = await supabase
        .from("organizer_accounts")
        .select("stripe_account_id")
        .eq("host_id", host_id)
        .maybeSingle();

      if (!account?.stripe_account_id) {
        return json({ error: "No connected Stripe account found. Start onboarding first." });
      }

      console.log("[organizer-connect] creating account_onboarding link for", account.stripe_account_id);
      const link = await stripeRequest("/account_links", {
        account: account.stripe_account_id,
        refresh_url: `${FUNCTION_BASE}?callback=refresh`,
        return_url: `${FUNCTION_BASE}?callback=return`,
        type: "account_onboarding",
      });

      if (!link.url || typeof link.url !== "string" || !link.url.startsWith("https://")) {
        return json({ error: "Stripe returned an invalid verification URL" });
      }

      return json({ url: link.url, account_id: account.stripe_account_id });
    }

    if (action === "status") {
      const { data: account } = await supabase
        .from("organizer_accounts")
        .select("*")
        .eq("host_id", host_id)
        .maybeSingle();

      if (!account?.stripe_account_id) {
        return json({ connected: false });
      }

      // Fetch from Stripe to get latest status
      const stripeAccount = await stripeGet(
        `/accounts/${account.stripe_account_id}`,
      );

      // Sync to DB
      await supabase
        .from("organizer_accounts")
        .update({
          charges_enabled: stripeAccount.charges_enabled,
          payouts_enabled: stripeAccount.payouts_enabled,
          details_submitted: stripeAccount.details_submitted,
          updated_at: new Date().toISOString(),
        })
        .eq("host_id", host_id);

      const reqs = stripeAccount.requirements || {};
      return json({
        connected: true,
        charges_enabled: stripeAccount.charges_enabled,
        payouts_enabled: stripeAccount.payouts_enabled,
        details_submitted: stripeAccount.details_submitted,
        stripe_account_id: account.stripe_account_id,
        // Fields Stripe is still waiting on from the user.
        currently_due: reqs.currently_due || [],
        // Fields Stripe is internally reviewing (ID upload, address, etc).
        // Account is otherwise complete; this is the "waiting on Stripe" set.
        pending_verification: reqs.pending_verification || [],
        // Past-due requirements that will disable the account if not fixed.
        past_due: reqs.past_due || [],
        // Stripe's short code for why the account isn't fully active.
        disabled_reason: reqs.disabled_reason || null,
        // Per-capability status. card_payments + transfers are the two we
        // need active for the ticket flow.
        capabilities: stripeAccount.capabilities || {},
      });
    }

    return json({ error: "Invalid action" });
  } catch (err: any) {
    console.error("[organizer-connect] Error:", err);
    return json({ error: err.message || "Internal error" });
  }
});
