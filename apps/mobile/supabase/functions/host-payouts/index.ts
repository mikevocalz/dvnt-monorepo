/**
 * Host Payouts Edge Function
 *
 * POST /host-payouts
 * Body: { action: "summary" | "list" | "detail", payout_id? }
 *
 * Returns payout data for organizers:
 *   - summary: available/pending balance, total paid out, next payout estimate
 *   - list: all payouts with gross/net/fee breakdown
 *   - detail: single payout with line items
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  verifySession,
  jsonResponse,
  errorResponse,
  optionsResponse,
} from "../_shared/verify-session.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const STRIPE_SECRET_KEY = Deno.env.get("STRIPE_SECRET_KEY") || "";

if (!STRIPE_SECRET_KEY) {
  console.error(
    "[host-payouts] FATAL: STRIPE_SECRET_KEY env var is not set.",
  );
}

async function stripeGet(
  endpoint: string,
  stripeAccount?: string,
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
  };
  if (stripeAccount) {
    headers["Stripe-Account"] = stripeAccount;
  }
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "GET",
    headers,
  });
  return res.json();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return optionsResponse();
  if (req.method !== "POST") return errorResponse("Method not allowed", 405);

  if (!STRIPE_SECRET_KEY) {
    return errorResponse(
      "Stripe is not configured for this environment. Contact support.",
      503,
    );
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    });
    const userId = await verifySession(supabase, req);
    if (!userId) return errorResponse("Unauthorized", 401);

    // Verify user is an organizer
    const { data: orgAccount } = await supabase
      .from("organizer_accounts")
      .select("stripe_account_id, charges_enabled, payouts_enabled")
      .eq("host_id", userId)
      .single();

    if (!orgAccount?.stripe_account_id) {
      return errorResponse(
        "Not an organizer or Stripe account not connected",
        403,
      );
    }

    const body = await req.json();
    const { action } = body;

    switch (action) {
      // ── Summary: balance overview ─────────────────────────
      case "summary": {
        let availableCents = 0;
        let pendingCents = 0;

        // Get Stripe Connect balance
        if (STRIPE_SECRET_KEY) {
          try {
            const balance = await stripeGet(
              `/balance`,
              orgAccount.stripe_account_id,
            );
            // Stripe returns an error object if the connected account can't access balance
            if (!balance.error) {
              const usdAvailable = (balance.available || []).find(
                (b: any) => b.currency === "usd",
              );
              const usdPending = (balance.pending || []).find(
                (b: any) => b.currency === "usd",
              );
              availableCents = usdAvailable?.amount || 0;
              pendingCents = usdPending?.amount || 0;
            }
          } catch (e) {
            console.error("[host-payouts] Stripe balance error:", e);
          }
        }

        // Total paid out from DB
        const { data: payoutAgg } = await supabase
          .from("payouts")
          .select("net_amount_cents")
          .eq("host_id", userId)
          .eq("status", "paid");

        const totalPayoutsCents = (payoutAgg || []).reduce(
          (sum: number, p: any) => sum + (p.net_amount_cents || 0),
          0,
        );

        // Next payout estimate from pending payouts
        const { data: nextPayout } = await supabase
          .from("payouts")
          .select("release_at")
          .eq("host_id", userId)
          .eq("status", "pending")
          .order("release_at", { ascending: true })
          .limit(1)
          .single();

        const nextPayoutEstimate = nextPayout?.release_at
          ? new Date(nextPayout.release_at).toLocaleDateString("en-US", {
              month: "short",
              day: "numeric",
            })
          : null;

        return jsonResponse({
          availableBalanceCents: availableCents,
          pendingBalanceCents: pendingCents,
          totalPayoutsCents,
          nextPayoutEstimate,
          currency: "usd",
        });
      }

      // ── List payouts ──────────────────────────────────────
      case "list": {
        const { data: payouts, error } = await supabase
          .from("payouts")
          .select("*, events(title)")
          .eq("host_id", userId)
          .order("created_at", { ascending: false })
          .limit(50);

        if (error) throw error;

        const mapped = (payouts || []).map((p: any) => ({
          id: p.id?.toString() || crypto.randomUUID(),
          eventId: p.event_id?.toString(),
          eventTitle: p.events?.title || "Event",
          status: p.status || "pending",
          grossCents: p.gross_amount_cents || 0,
          netCents: p.net_amount_cents || 0,
          feeCents: p.platform_fee_cents || 0,
          currency: "usd",
          releaseAt: p.release_at || p.created_at,
          arrivalDate: p.arrival_date || null,
          bankLast4: p.bank_last4 || null,
          stripePayoutId: p.stripe_payout_id || null,
        }));

        return jsonResponse({ data: mapped, hasMore: false });
      }

      // ── Payout detail ─────────────────────────────────────
      case "detail": {
        const { payout_id } = body;
        if (!payout_id) return errorResponse("payout_id required");

        const { data: payout, error } = await supabase
          .from("payouts")
          .select("*, events(title)")
          .eq("id", parseInt(payout_id))
          .eq("host_id", userId)
          .single();

        if (error || !payout) return errorResponse("Payout not found", 404);

        return jsonResponse({
          id: payout.id?.toString(),
          eventId: payout.event_id?.toString(),
          eventTitle: payout.events?.title || "Event",
          status: payout.status,
          grossCents: payout.gross_amount_cents || 0,
          netCents: payout.net_amount_cents || 0,
          feeCents: payout.platform_fee_cents || 0,
          currency: "usd",
          releaseAt: payout.release_at,
          arrivalDate: payout.arrival_date,
          bankLast4: payout.bank_last4,
          stripePayoutId: payout.stripe_payout_id,
        });
      }

      default:
        return errorResponse(`Unknown action: ${action}`);
    }
  } catch (err: any) {
    console.error("[host-payouts] Error:", err);
    return errorResponse(err.message || "Internal error", 500);
  }
});
