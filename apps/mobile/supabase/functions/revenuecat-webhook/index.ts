/**
 * RevenueCat Webhook Handler (Edge Function)
 *
 * Mobile (iOS / Play) rail counterpart to `stripe-webhook`. Lands rows in
 * the SAME `membership_subscriptions` table so web and native resolve
 * through one `is_entitled(uid)` (I3).
 *
 * Auth (I4):
 *   RevenueCat classic webhooks send `Authorization: Bearer <shared>` with
 *   the secret configured in their dashboard. We compare it constant-time
 *   against `REVENUECAT_WEBHOOK_SECRET` and fail closed (I2) on mismatch.
 *
 * Idempotency (I2):
 *   `rc_events.event_id` unique constraint. Duplicate delivery → no-op.
 *
 * Monotonic guard (I5):
 *   `upsert_membership_subscription` RPC refuses to write if
 *   `last_event_at` is already newer. The same race protection used by
 *   `stripe-webhook`.
 *
 * Identity (I1):
 *   `app_user_id` MUST equal the DVNT user_id. Wired client-side via
 *   `Purchases.logIn(user.id)`. We never auto-provision an account from
 *   a webhook — if `app_user_id` is the RC-generated `$RCAnonymousID:...`
 *   we drop and log.
 *
 * RevenueCat v2 event reference:
 *   https://www.revenuecat.com/docs/integrations/webhooks/event-types-and-fields
 */

import { withSentry } from "../_shared/sentry.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const RC_WEBHOOK_SECRET = Deno.env.get("REVENUECAT_WEBHOOK_SECRET") || "";

type RCRail = "ios_iap" | "play_iap";

type RCEvent = {
  id: string;
  type:
    | "INITIAL_PURCHASE"
    | "RENEWAL"
    | "CANCELLATION"
    | "UNCANCELLATION"
    | "EXPIRATION"
    | "BILLING_ISSUE"
    | "PRODUCT_CHANGE"
    | "TRANSFER"
    | "SUBSCRIPTION_PAUSED"
    | "NON_RENEWING_PURCHASE"
    | "TEST";
  event_timestamp_ms: number;
  app_user_id: string;
  original_app_user_id?: string;
  aliases?: string[];
  store: "APP_STORE" | "PLAY_STORE" | "STRIPE" | "AMAZON" | "MAC_APP_STORE" | "PROMOTIONAL";
  product_id?: string;
  new_product_id?: string;
  expiration_at_ms?: number;
  purchased_at_ms?: number;
  // Set on CANCELLATION/EXPIRATION events.
  cancel_reason?: string;
  // RC sets this on subscription_paused / billing-issue grace.
  grace_period_expiration_at_ms?: number;
  environment?: "SANDBOX" | "PRODUCTION";
};

// Map RC store → our rail enum. STRIPE/PROMOTIONAL/AMAZON/MAC are out of
// scope for the mobile rail today; reject so the entitlement state can't
// silently land in the wrong column.
function railFromStore(store: RCEvent["store"]): RCRail | null {
  if (store === "APP_STORE") return "ios_iap";
  if (store === "PLAY_STORE") return "play_iap";
  return null;
}

// Map RC event type → our membership_subscriptions.status. CANCELLATION
// in RC means "user canceled but still entitled until period end" — we
// keep status='active' and set cancel_at_period_end=true, mirroring how
// Stripe represents a canceled-not-expired subscription.
function statusFromEvent(
  ev: RCEvent,
): { status: string; cancelAtPeriodEnd: boolean } | null {
  switch (ev.type) {
    case "INITIAL_PURCHASE":
    case "RENEWAL":
    case "UNCANCELLATION":
    case "PRODUCT_CHANGE":
      return { status: "active", cancelAtPeriodEnd: false };
    case "CANCELLATION":
      return { status: "active", cancelAtPeriodEnd: true };
    case "EXPIRATION":
      return { status: "canceled", cancelAtPeriodEnd: false };
    case "BILLING_ISSUE":
    case "SUBSCRIPTION_PAUSED":
      return { status: "past_due", cancelAtPeriodEnd: false };
    // Transfer, non-renewing one-shots, and test events don't move
    // subscription state in this table.
    case "TRANSFER":
    case "NON_RENEWING_PURCHASE":
    case "TEST":
    default:
      return null;
  }
}

// Constant-time bearer-token compare.
function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function isAnonRCId(uid: string): boolean {
  // RC generates `$RCAnonymousID:<hex>` before `Purchases.logIn(user.id)`.
  // We never auto-provision off an anon id — that's an unmapped purchase
  // and a sev (I1).
  return uid.startsWith("$RCAnonymousID:");
}

Deno.serve(withSentry("revenuecat-webhook", async (req) => {
  if (req.method !== "POST") {
    return new Response("Method Not Allowed", { status: 405 });
  }

  if (!RC_WEBHOOK_SECRET) {
    console.error(
      "[revenuecat-webhook] REVENUECAT_WEBHOOK_SECRET not configured — rejecting",
    );
    return new Response("Server misconfigured", { status: 500 });
  }

  // I4 — bearer token verify, fail closed.
  const authHeader = req.headers.get("authorization") || "";
  const expected = `Bearer ${RC_WEBHOOK_SECRET}`;
  if (!safeCompare(authHeader, expected)) {
    return new Response("Unauthorized", { status: 401 });
  }

  let body: { event?: RCEvent };
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const ev = body.event;
  if (!ev?.id || !ev.type) {
    return new Response("Missing event", { status: 400 });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  // I2 — dedup by event id. Use insert + on-conflict-do-nothing to keep
  // it a single round-trip.
  const { error: dedupErr, data: dedupRow } = await supabase
    .from("rc_events")
    .insert({
      event_id: ev.id,
      app_user_id: ev.app_user_id,
      event_type: ev.type,
      product_id: ev.product_id ?? ev.new_product_id ?? null,
      payload: ev,
    })
    .select("event_id")
    .maybeSingle();

  if (dedupErr && dedupErr.code !== "23505") {
    // 23505 = unique_violation = already processed. Anything else is real.
    console.error("[revenuecat-webhook] dedup insert error", dedupErr);
    return new Response("Server error", { status: 500 });
  }
  if (!dedupRow && !dedupErr) {
    // maybeSingle returned no row but no insert error — already processed.
    console.log(`[revenuecat-webhook] duplicate event ${ev.id} — skipping`);
    return new Response("ok", { status: 200 });
  }

  // I1 — refuse anonymous app_user_id. The mobile client wires
  // Purchases.logIn(user.id) at sign-in; if we got here without it, the
  // mobile bootstrap is buggy and this purchase has no canonical owner.
  if (isAnonRCId(ev.app_user_id)) {
    console.error(
      `[revenuecat-webhook] anonymous app_user_id on ${ev.type} ${ev.id} — refusing to provision`,
    );
    return new Response("Anonymous app_user_id; refusing to provision", {
      status: 400,
    });
  }

  const rail = railFromStore(ev.store);
  if (!rail) {
    console.log(
      `[revenuecat-webhook] store=${ev.store} is not a mobile rail — acked, no state change`,
    );
    return new Response("ok", { status: 200 });
  }

  const transition = statusFromEvent(ev);
  if (!transition) {
    console.log(
      `[revenuecat-webhook] ${ev.type} does not move subscription state — acked`,
    );
    return new Response("ok", { status: 200 });
  }

  const planKey = ev.new_product_id ?? ev.product_id;
  if (!planKey) {
    return new Response("Missing product_id", { status: 400 });
  }

  // For mobile: provider_ref = original_app_user_id + product_id is the
  // most stable id RC exposes per-subscription (transaction ids change on
  // renewals). When `original_app_user_id` isn't present we fall back to
  // app_user_id.
  const providerRef = `${ev.original_app_user_id ?? ev.app_user_id}:${planKey}`;

  const { data: applied, error: rpcErr } = await supabase.rpc(
    "upsert_membership_subscription",
    {
      p_user_id: ev.app_user_id,
      p_rail: rail,
      p_product_family: "dvnt_membership",
      p_plan_key: planKey,
      p_status: transition.status,
      p_provider_ref: providerRef,
      // No Stripe identifiers on the mobile rail.
      p_stripe_customer_id: null,
      p_stripe_subscription_id: null,
      p_stripe_price_id: null,
      p_current_period_start: ev.purchased_at_ms
        ? new Date(ev.purchased_at_ms).toISOString()
        : null,
      p_current_period_end: ev.expiration_at_ms
        ? new Date(ev.expiration_at_ms).toISOString()
        : null,
      p_cancel_at_period_end: transition.cancelAtPeriodEnd,
      p_canceled_at:
        transition.status === "canceled" || transition.cancelAtPeriodEnd
          ? new Date(ev.event_timestamp_ms).toISOString()
          : null,
      p_event_created_at: new Date(ev.event_timestamp_ms).toISOString(),
    },
  );

  if (rpcErr) {
    console.error("[revenuecat-webhook] upsert RPC error", rpcErr);
    return new Response("Server error", { status: 500 });
  }
  if (applied === false) {
    console.log(
      `[revenuecat-webhook] stale event skipped for ${ev.app_user_id} (${ev.id})`,
    );
  } else {
    console.log(
      `[revenuecat-webhook] ${ev.type} for ${ev.app_user_id}: ${planKey} ${transition.status} (rail=${rail})`,
    );
  }

  return new Response("ok", { status: 200 });
}));
