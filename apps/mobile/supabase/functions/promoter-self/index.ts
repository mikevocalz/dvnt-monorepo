import { readSettlementSummary } from "../_shared/settlement-status.ts";
/**
 * Promoter Self-Service Edge Function (Phase 3)
 *
 * POST /promoter-self
 *   { action: "me", event_id }
 *
 * Returns the current user's promoter record for the event, including
 * net earnings, attribution count, and Connect onboarding state. Used by
 * the promoter-facing "My promotion" screen.
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { verifySession } from "../_shared/verify-session.ts";
import { withSentry } from "../_shared/sentry.ts";
import { readAllRows } from "../_shared/read-all-rows.ts";
import { promoterPayoutSummary, type PromoterPayoutRow } from "../_shared/promoter-payout-summary.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

Deno.serve(withSentry("promoter-self", async (req: Request) => {
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
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });

    const userId = await verifySession(supabase, req);
    if (!userId) {
      return json({ error: "Unauthorized" }, 401);
    }

    const body = await req.json().catch(() => ({}));
    const action = String(body.action || "");
    const eventId = Number(body.event_id);

    if (action !== "me") {
      return json({ error: "Invalid action" }, 400);
    }
    if (!Number.isSafeInteger(eventId) || eventId <= 0) {
      return json({ error: "event_id required" }, 400);
    }

    const { data: promoter, error } = await supabase
      .from("event_promoters")
      .select(
        "id, code, status, customer_discount_bps, promoter_commission_bps, stripe_account_id, charges_enabled, payouts_enabled, details_submitted, created_at",
      )
      .eq("event_id", eventId)
      .eq("user_id", userId)
      .neq("status", "removed")
      .maybeSingle();

    if (error) {
      console.error("[promoter-self] lookup error:", error);
      return json({ error: "Could not load promoter record" }, 500);
    }
    if (!promoter) {
      return json({ ok: true, isPromoter: false });
    }

    // Net earnings from the ledger (earnings - reversals) for this promoter.
    let ledger: (PromoterPayoutRow & { id: string })[];
    try {
      ledger = await readAllRows(() => supabase
        .from("promoter_ledger_entries")
        .select("id, amount_cents, entry_type, payout_status, paid_out_at, stripe_transfer_id")
        .eq("promoter_id", promoter.id));
    } catch (error) {
      console.error("[promoter-self] earnings lookup error:", error);
      return json({ error: "Could not load promoter earnings" }, 500);
    }

    if (ledger.some(row => !Number.isSafeInteger(row.amount_cents))) {
      return json({ error: "Could not load promoter earnings" }, 500);
    }
    const earnedCents = ledger.reduce(
      (sum: number, row: { amount_cents: number }) => sum + (row.amount_cents || 0),
      0,
    );

    if (!Number.isSafeInteger(earnedCents)) {
      return json({ error: "Could not load promoter earnings" }, 500);
    }

    // One attribution per order; order_id is the table primary key.
    const { count: attributedOrders, error: attributionError } = await supabase
      .from("promoter_attributions")
      .select("order_id", { count: "exact", head: true })
      .eq("promoter_id", promoter.id);

    if (attributionError || attributedOrders === null) {
      console.error("[promoter-self] attribution lookup error:", attributionError);
      return json({ error: "Could not load promoter attributed orders" }, 500);
    }

    // Keep earnings visible if event payout status is unavailable, but never
    // manufacture a pending/paid result from a failed status read.
    const { data: event, error: eventError } = await supabase.from("events")
      .select("payout_status").eq("id", eventId).maybeSingle();
    const payout = eventError || !event ? null
      : promoterPayoutSummary(ledger, event.payout_status);

    return json({
      ok: true,
      isPromoter: true,
      promoter: {
        id: promoter.id,
        code: promoter.code,
        status: promoter.status,
        customerDiscountBps: promoter.customer_discount_bps,
        promoterCommissionBps: promoter.promoter_commission_bps,
        attributedOrders,
        earnedCents,
        settlement: await readSettlementSummary(supabase, userId, eventId),
        payout,
        connect: {
          stripeAccountId: promoter.stripe_account_id,
          chargesEnabled: promoter.charges_enabled,
          payoutsEnabled: promoter.payouts_enabled,
          detailsSubmitted: promoter.details_submitted,
        },
      },
    });
  } catch (err: any) {
    console.error("[promoter-self] Error:", err);
    return json({ error: err.message || "Internal error" }, 500);
  }
}));
