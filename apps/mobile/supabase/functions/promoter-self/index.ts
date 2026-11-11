import { readLegacyOwnershipSummary } from "../_shared/legacy-ownership-summary.ts";
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
    // Frozen allocation/external-receipt ownership, not a mutable roster row,
    // authorizes financial history. Never expose organizer rows on this screen.
    const rawSettlement = await readSettlementSummary(supabase, userId, eventId);
    const settlement = { ...rawSettlement, rows: rawSettlement.rows.filter(
      (row: any) => row.recipient_role === "promoter",
    ) };
    const legacyHistory = await readLegacyOwnershipSummary(supabase, userId, eventId);
    if (!promoter) {
      if ((!settlement.verified || !legacyHistory.verified) && !settlement.rows.length && !legacyHistory.rows.length) return json({ error: "Could not verify promoter payment history" }, 503);
      return json({ ok: true, isPromoter: false,
        ...(settlement.rows.length ? { paymentHistory: settlement } : {}),
        ...(legacyHistory.rows.length ? { legacyHistory } : {}),
      });
    }

    // promoter_id is mutable ownership, not proof of who earned historical
    // ledger rows or referrals. Legacy tables have no immutable actor column.
    // Known-owned new allocations AND legacy external receipts remain visible
    // through settlement_actor_summary. Do not sum its gross transfer amounts
    // as net earnings or silently turn unknown legacy history into zero.
    return json({
      ok: true,
      isPromoter: true,
      promoter: {
        id: promoter.id,
        code: promoter.code,
        status: promoter.status,
        customerDiscountBps: promoter.customer_discount_bps,
        promoterCommissionBps: promoter.promoter_commission_bps,
        attributedOrders: null,
        earnedCents: null,
        earningsScope: "unverified_history",
        settlement,
        legacyHistory,
        payout: null,
        payoutScope: "unavailable",
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
    return json({ error: "Could not load promoter information" }, 500);
  }
}));
