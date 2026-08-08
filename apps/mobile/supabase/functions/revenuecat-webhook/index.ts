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
    | "SUBSCRIPTION_EXTENDED"
    | "REFUND_REVERSED"
    | "NON_RENEWING_PURCHASE"
    | "TEST";
  event_timestamp_ms: number;
  app_user_id: string;
  original_app_user_id?: string;
  aliases?: string[];
  // TRANSFER only: RC delivers the event to the destination user; these are
  // the source App User IDs whose entitlement moved away.
  transferred_from?: string[];
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
    // A store-API extension pushes the period end out; the new
    // expiration_at_ms rides the normal upsert below.
    case "SUBSCRIPTION_EXTENDED":
    // App Store refund reversal: access must be restored.
    case "REFUND_REVERSED":
      return { status: "active", cancelAtPeriodEnd: false };
    case "CANCELLATION":
      // cancel_reason=CUSTOMER_SUPPORT is a refund — access is revoked now,
      // not at period end. Every other reason keeps entitlement to period
      // end (EXPIRATION follows and settles it either way).
      if (ev.cancel_reason === "CUSTOMER_SUPPORT") {
        return { status: "canceled", cancelAtPeriodEnd: false };
      }
      return { status: "active", cancelAtPeriodEnd: true };
    case "EXPIRATION":
      // expiration_reason stays queryable in rc_events.payload.
      return { status: "canceled", cancelAtPeriodEnd: false };
    case "BILLING_ISSUE":
      return { status: "past_due", cancelAtPeriodEnd: false };
    // Play pause is SCHEDULED for period end — the user stays entitled until
    // EXPIRATION fires. Revoking here (old behavior: past_due) cut paid
    // users off early. State doesn't move; EXPIRATION settles it.
    case "SUBSCRIPTION_PAUSED":
    // Transfer is handled explicitly in the request path (source rows must
    // be canceled); non-renewing one-shots and test events don't move
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
    console.error("[revenuecat-webhook] dedup insert error", dedupErr);
    return new Response("Server error", { status: 500 });
  }
  if (!dedupRow) {
    // Duplicate delivery. Skip ONLY if the first attempt finished — a row
    // with processed_at NULL means we 500'd mid-processing and RC is
    // retrying; swallowing that retry would drop the transition for good.
    const { data: prior } = await supabase
      .from("rc_events")
      .select("processed_at")
      .eq("event_id", ev.id)
      .maybeSingle();
    if (prior?.processed_at) {
      console.log(`[revenuecat-webhook] duplicate event ${ev.id} — skipping`);
      return new Response("ok", { status: 200 });
    }
    console.log(
      `[revenuecat-webhook] retry of unfinished event ${ev.id} — reprocessing`,
    );
  }

  const markProcessed = async () => {
    await supabase
      .from("rc_events")
      .update({ processed_at: new Date().toISOString() })
      .eq("event_id", ev.id);
  };

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
    await markProcessed();
    return new Response("ok", { status: 200 });
  }

  // TRANSFER: RC notifies the destination user only. With one row per user,
  // the source users' rows would otherwise stay `active` forever. Cancel
  // each source row through the same guarded RPC (single write path), then
  // grant the destination from the source's plan when the event carries no
  // product id of its own.
  if (ev.type === "TRANSFER") {
    const sources = (ev.transferred_from ?? []).filter((u) => !isAnonRCId(u));
    let sourcePlanKey: string | null = null;
    for (const sourceId of sources) {
      const { data: row } = await supabase
        .from("membership_subscriptions")
        .select("plan_key, rail, provider_ref, current_period_start, current_period_end")
        .eq("user_id", sourceId)
        .maybeSingle();
      if (!row || (row.rail !== "ios_iap" && row.rail !== "play_iap")) continue;
      sourcePlanKey = sourcePlanKey ?? row.plan_key;
      const { error: srcErr } = await supabase.rpc(
        "upsert_membership_subscription",
        {
          p_user_id: sourceId,
          p_rail: row.rail,
          p_product_family: "dvnt_membership",
          p_plan_key: row.plan_key,
          p_status: "canceled",
          p_provider_ref: row.provider_ref,
          p_stripe_customer_id: null,
          p_stripe_subscription_id: null,
          p_stripe_price_id: null,
          p_current_period_start: row.current_period_start,
          p_current_period_end: row.current_period_end,
          p_cancel_at_period_end: false,
          p_canceled_at: new Date(ev.event_timestamp_ms).toISOString(),
          p_event_created_at: new Date(ev.event_timestamp_ms).toISOString(),
        },
      );
      if (srcErr) {
        console.error("[revenuecat-webhook] TRANSFER source cancel error", srcErr);
        return new Response("Server error", { status: 500 });
      }
    }
    const destPlanKey = ev.new_product_id ?? ev.product_id ?? sourcePlanKey;
    if (destPlanKey) {
      const { error: dstErr } = await supabase.rpc(
        "upsert_membership_subscription",
        {
          p_user_id: ev.app_user_id,
          p_rail: rail,
          p_product_family: "dvnt_membership",
          p_plan_key: destPlanKey,
          p_status: "active",
          p_provider_ref: `${ev.original_app_user_id ?? ev.app_user_id}:${destPlanKey}`,
          p_stripe_customer_id: null,
          p_stripe_subscription_id: null,
          p_stripe_price_id: null,
          p_current_period_start: ev.purchased_at_ms
            ? new Date(ev.purchased_at_ms).toISOString()
            : null,
          p_current_period_end: ev.expiration_at_ms
            ? new Date(ev.expiration_at_ms).toISOString()
            : null,
          p_cancel_at_period_end: false,
          p_canceled_at: null,
          p_event_created_at: new Date(ev.event_timestamp_ms).toISOString(),
        },
      );
      if (dstErr) {
        console.error("[revenuecat-webhook] TRANSFER destination upsert error", dstErr);
        return new Response("Server error", { status: 500 });
      }
    }
    console.log(
      `[revenuecat-webhook] TRANSFER → ${ev.app_user_id} (${sources.length} source(s) canceled)`,
    );
    await markProcessed();
    return new Response("ok", { status: 200 });
  }

  const transition = statusFromEvent(ev);
  if (!transition) {
    console.log(
      `[revenuecat-webhook] ${ev.type} does not move subscription state — acked`,
    );
    await markProcessed();
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
    // Mirror the Stripe rail: BILLING_ISSUE carries RC's grace horizon —
    // persist it so is_entitled()'s past_due+grace clause can honor it.
    // First-write only, and only when the guarded upsert actually applied.
    if (ev.type === "BILLING_ISSUE" && ev.grace_period_expiration_at_ms) {
      await supabase
        .from("membership_subscriptions")
        .update({
          grace_period_ends_at: new Date(
            ev.grace_period_expiration_at_ms,
          ).toISOString(),
        })
        .eq("user_id", ev.app_user_id)
        .is("grace_period_ends_at", null);
    }
  }

  await markProcessed();
  return new Response("ok", { status: 200 });
}));
