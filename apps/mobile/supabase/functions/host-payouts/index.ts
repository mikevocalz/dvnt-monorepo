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

async function stripePost(
  endpoint: string,
  body: Record<string, string>,
  stripeAccount?: string,
  idempotencyKey?: string,
): Promise<any> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (stripeAccount) headers["Stripe-Account"] = stripeAccount;
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`https://api.stripe.com/v1${endpoint}`, {
    method: "POST",
    headers,
    body: new URLSearchParams(body).toString(),
  });
  return res.json();
}

/** usd amount from a Stripe balance bucket array (available/pending/instant). */
function usdAmount(bucket: any[] | undefined): number {
  const usd = (bucket || []).find((b: any) => b.currency === "usd");
  return usd?.amount || 0;
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
        // Instant payout eligibility: Stripe only populates
        // balance.instant_available when the connected account has an
        // instant-payout-capable debit card attached, so a positive usd
        // instant_available is the authoritative eligibility signal.
        let instantAvailableCents = 0;

        // Get Stripe Connect balance
        if (STRIPE_SECRET_KEY) {
          try {
            const balance = await stripeGet(
              `/balance`,
              orgAccount.stripe_account_id,
            );
            // Stripe returns an error object if the connected account can't access balance
            if (!balance.error) {
              availableCents = usdAmount(balance.available);
              pendingCents = usdAmount(balance.pending);
              instantAvailableCents = usdAmount(balance.instant_available);
            }
          } catch (e) {
            console.error("[host-payouts] Stripe balance error:", e);
          }
        }

        // Total paid out from DB
        const { data: payoutAgg } = await supabase
          .from("payouts")
          .select("net_cents")
          .eq("host_id", userId)
          .eq("status", "paid");

        const totalPayoutsCents = (payoutAgg || []).reduce(
          (sum: number, p: any) => sum + (p.net_cents || 0),
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
          instantAvailableCents,
          instantPayoutEligible: instantAvailableCents > 0,
          payoutsEnabled: !!orgAccount.payouts_enabled,
          totalPayoutsCents,
          nextPayoutEstimate,
          currency: "usd",
        });
      }

      // ── Failed bank payouts (recovery surface) ────────────
      // The connected account's automatic bank payouts (Stripe Payout
      // objects), not our transfer rows — these are what fail when a bank
      // is closed/invalid. Returns the actionable reason straight from
      // Stripe so the UI can render a recovery flow, never a bare chip.
      case "failed_payouts": {
        const payoutsRes = await stripeGet(
          `/payouts?limit=10&status=failed`,
          orgAccount.stripe_account_id,
        );
        if (payoutsRes.error) {
          return jsonResponse({ data: [] });
        }
        const mapped = (payoutsRes.data || []).map((p: any) => ({
          id: p.id,
          amountCents: p.amount || 0,
          currency: p.currency || "usd",
          failureCode: p.failure_code || null,
          failureMessage: p.failure_message || null,
          arrivalDate: p.arrival_date
            ? new Date(p.arrival_date * 1000).toISOString()
            : null,
          created: p.created
            ? new Date(p.created * 1000).toISOString()
            : null,
          // A failed payout can be re-attempted once the destination is
          // fixed; Stripe exposes this on the payout object.
          reconcilable: p.reconciliation_status !== "not_applicable",
        }));
        return jsonResponse({ data: mapped });
      }

      // ── Instant payout (eligible accounts only) ───────────
      case "instant_payout": {
        const balance = await stripeGet(
          `/balance`,
          orgAccount.stripe_account_id,
        );
        if (balance.error) {
          return errorResponse("Could not read your balance", 502);
        }
        const instantCents = usdAmount(balance.instant_available);
        if (instantCents <= 0) {
          // Gate strictly on eligibility; fall back to standard.
          return jsonResponse({
            ok: false,
            eligible: false,
            message:
              "Instant payouts aren't available on this account. Add an instant-payout-capable debit card in Stripe, or funds will arrive on the standard schedule.",
          });
        }
        const requested =
          typeof body.amount_cents === "number" && body.amount_cents > 0
            ? Math.min(body.amount_cents, instantCents)
            : instantCents;
        const payout = await stripePost(
          `/payouts`,
          {
            amount: requested.toString(),
            currency: "usd",
            method: "instant",
            "metadata[type]": "instant_payout",
            "metadata[host_id]": userId,
          },
          orgAccount.stripe_account_id,
          `instant_payout:${userId}:${requested}`,
        );
        if (payout.error) {
          return jsonResponse({
            ok: false,
            eligible: true,
            message: payout.error.message || "Instant payout failed",
          });
        }
        return jsonResponse({
          ok: true,
          payoutId: payout.id,
          amountCents: payout.amount,
          arrivalDate: payout.arrival_date
            ? new Date(payout.arrival_date * 1000).toISOString()
            : null,
        });
      }

      // ── Retry a bank payout after fixing bank details ─────
      // Stripe cannot "retry" a failed payout object; the recovery is a
      // fresh standard payout of the available balance once the external
      // account is valid again.
      case "retry_payout": {
        const balance = await stripeGet(
          `/balance`,
          orgAccount.stripe_account_id,
        );
        if (balance.error) {
          return errorResponse("Could not read your balance", 502);
        }
        const availableCents = usdAmount(balance.available);
        if (availableCents <= 0) {
          return jsonResponse({
            ok: false,
            message: "No available balance to pay out yet.",
          });
        }
        const payout = await stripePost(
          `/payouts`,
          {
            amount: availableCents.toString(),
            currency: "usd",
            method: "standard",
            "metadata[type]": "retry_payout",
            "metadata[host_id]": userId,
          },
          orgAccount.stripe_account_id,
        );
        if (payout.error) {
          return jsonResponse({
            ok: false,
            message: payout.error.message || "Retry failed",
          });
        }
        return jsonResponse({
          ok: true,
          payoutId: payout.id,
          amountCents: payout.amount,
          arrivalDate: payout.arrival_date
            ? new Date(payout.arrival_date * 1000).toISOString()
            : null,
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

        const mapped = (payouts || []).map((p: any) => {
          // `payouts` real columns: gross_cents, net_cents. There is no
          // platform_fee_cents column — the platform fee IS gross - net.
          const grossCents = p.gross_cents || 0;
          const netCents = p.net_cents || 0;
          return {
            id: p.id, // uuid string — pass through, never parseInt
            eventId: p.event_id?.toString(),
            eventTitle: p.events?.title || "Event",
            status: p.status || "pending",
            grossCents,
            netCents,
            feeCents: grossCents - netCents,
            currency: "usd",
            releaseAt: p.release_at || p.created_at,
            createdAt: p.created_at,
            stripePayoutId: p.stripe_payout_id || null,
          };
        });

        return jsonResponse({ data: mapped, hasMore: false });
      }

      // ── Payout detail ─────────────────────────────────────
      case "detail": {
        const { payout_id } = body;
        if (!payout_id) return errorResponse("payout_id required");

        const { data: payout, error } = await supabase
          .from("payouts")
          .select("*, events(title)")
          .eq("id", payout_id) // uuid string — do NOT parseInt
          .eq("host_id", userId)
          .single();

        if (error || !payout) return errorResponse("Payout not found", 404);

        // Real columns: gross_cents, net_cents. platform_fee = gross - net
        // (no platform_fee_cents column). bank_last4 / arrival_date are not
        // DB columns and the detail path doesn't fetch the Stripe Payout, so
        // they're intentionally absent from the response.
        const grossCents = payout.gross_cents || 0;
        const netCents = payout.net_cents || 0;
        return jsonResponse({
          id: payout.id, // uuid string
          eventId: payout.event_id?.toString(),
          eventTitle: payout.events?.title || "Event",
          status: payout.status,
          grossCents,
          netCents,
          feeCents: grossCents - netCents,
          currency: "usd",
          releaseAt: payout.release_at,
          createdAt: payout.created_at,
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
