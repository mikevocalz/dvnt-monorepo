/**
 * Order money-state + promoter ledger helpers shared between the Stripe
 * webhook and the reconcile-orders sweep. Extracted verbatim from
 * stripe-webhook/index.ts.
 */

import { computeFees } from "./fee-calculator.ts";

/**
 * Route an order money-state write through the guarded RPC
 * (migration 20260806100100). Monotonic on `last_event_at`: a stale
 * event (older Stripe event.created) is a guaranteed no-op — same
 * pattern as upsert_membership_subscription. Optional params COALESCE
 * server-side, so passing null never clears previously-written refs.
 * Errors are logged, not thrown: the stripe_events dedupe row is
 * already written, so a throw would make Stripe retry into a skip.
 */
export async function upsertOrderMoneyState(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  args: {
    orderId: string;
    status: string;
    eventCreatedAt: string;
    stripePaymentIntentId?: string | null;
    paymentMethodLast4?: string | null;
    paymentMethodBrand?: string | null;
    paidAt?: string | null;
    refundedAt?: string | null;
  },
): Promise<boolean> {
  const { data: applied, error } = await supabase.rpc(
    "upsert_order_money_state",
    {
      p_order_id: args.orderId,
      p_status: args.status,
      p_event_created_at: args.eventCreatedAt,
      p_stripe_payment_intent_id: args.stripePaymentIntentId ?? null,
      p_payment_method_last4: args.paymentMethodLast4 ?? null,
      p_payment_method_brand: args.paymentMethodBrand ?? null,
      p_paid_at: args.paidAt ?? null,
      p_refunded_at: args.refundedAt ?? null,
    },
  );
  if (error) {
    console.error(
      `[stripe-webhook] upsert_order_money_state failed for order ${args.orderId} (→ ${args.status}):`,
      error,
    );
    return false;
  }
  if (applied === false) {
    console.log(
      `[stripe-webhook] stale order event skipped for ${args.orderId} (→ ${args.status}, event_created=${args.eventCreatedAt})`,
    );
  }
  return applied === true;
}

// ── Promoter economy (WS-4) ──────────────────────────────────────────
// LEDGER BASE (documented decision): a promoter's earning is
//   floor(locked_rev_share_bps × organizer_transfer_amount / 10000)
// where organizer_transfer_amount = order.subtotal_cents −
// order.organizer_fee_cents — i.e. the organizer-side NET the connected
// account actually receives for the destination charge (see
// _shared/fee-calculator.ts: organizer_transfer_amount = subtotal −
// organizer_fee). Buyer-side fees and the application fee never reach
// the organizer, so the promoter's cut comes out of the organizer's
// net, never DVNT's fee or the gross charge. Integer cents only.
//
// Both writes are idempotent (attribution on order_id, ledger on
// (order_id, entry_type)) so webhook replays can never double-pay.
// Failures here are logged and swallowed — promoter bookkeeping must
// never fail ticket issuance or the webhook 200.
export async function recordPromoterEarning(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  orderId: string | null | undefined,
  promoterCode: string | null | undefined,
): Promise<void> {
  if (!orderId || !promoterCode) return;
  try {
    const { data: attr, error: attrError } = await supabase.rpc(
      "record_promoter_attribution",
      { p_order_id: orderId, p_code: promoterCode },
    );
    if (attrError) {
      console.error("[stripe-webhook] promoter attribution error:", attrError);
      return;
    }
    if (!attr?.ok) {
      // promoter_not_found / order_not_found — invalid or paused code;
      // nothing to ledger.
      console.log(
        `[stripe-webhook] promoter attribution skipped (${attr?.error || "unknown"}) for order ${orderId}`,
      );
      return;
    }

    // Locked share single source of truth = the attribution row (the
    // RPC returns the promoter's CURRENT bps on an idempotent replay,
    // which may have been edited since the order locked).
    const { data: locked } = await supabase
      .from("promoter_attributions")
      .select("promoter_id, locked_rev_share_bps")
      .eq("order_id", orderId)
      .maybeSingle();
    if (!locked?.promoter_id) return;

    const { data: order } = await supabase
      .from("orders")
      .select("subtotal_cents, organizer_fee_cents, quantity")
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return;

    // Organizer-side net (see LEDGER BASE above). If the fee columns
    // are missing (legacy rows) recompute from the canonical calculator.
    let organizerNet: number | null = null;
    if (
      Number.isInteger(order.subtotal_cents) &&
      Number.isInteger(order.organizer_fee_cents)
    ) {
      organizerNet = order.subtotal_cents - order.organizer_fee_cents;
    } else if (
      Number.isInteger(order.subtotal_cents) &&
      order.subtotal_cents > 0
    ) {
      try {
        organizerNet = computeFees(
          order.subtotal_cents,
          Number.isInteger(order.quantity) && order.quantity > 0
            ? order.quantity
            : 1,
        ).organizer_transfer_amount;
      } catch {
        organizerNet = null;
      }
    }
    if (organizerNet == null || organizerNet <= 0) return;

    const earningCents = Math.floor(
      (organizerNet * locked.locked_rev_share_bps) / 10000,
    );
    if (!Number.isInteger(earningCents) || earningCents <= 0) return;

    const { data: ledger, error: ledgerError } = await supabase.rpc(
      "record_promoter_ledger_entry",
      {
        p_promoter_id: locked.promoter_id,
        p_order_id: orderId,
        p_entry_type: "earning",
        p_amount_cents: earningCents,
        p_currency: "usd",
        p_stripe_transfer_id: null,
      },
    );
    if (ledgerError) {
      console.error("[stripe-webhook] promoter ledger error:", ledgerError);
      return;
    }
    console.log(
      `[stripe-webhook] promoter earning ${ledger?.applied ? "recorded" : "already recorded"}: order ${orderId}, ${earningCents}¢ @ ${locked.locked_rev_share_bps}bps`,
    );
  } catch (err) {
    console.error("[stripe-webhook] recordPromoterEarning failed:", err);
  }
}

// Reverse a promoter earning on refund / transfer reversal. Full
// clawback by design: the uniq (order_id, entry_type) constraint allows
// exactly one reversal row per order, so even a partial refund reverses
// the entire earning — conservative (a promoter is never overpaid on a
// disputed/refunded order) and idempotent on webhook replay.
export async function recordPromoterReversal(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  orderId: string | null | undefined,
  stripeTransferId: string | null = null,
): Promise<void> {
  if (!orderId) return;
  try {
    const { data: earning } = await supabase
      .from("promoter_ledger_entries")
      .select("promoter_id, amount_cents, currency")
      .eq("order_id", orderId)
      .eq("entry_type", "earning")
      .maybeSingle();
    if (!earning || !Number.isInteger(earning.amount_cents)) return;
    if (earning.amount_cents <= 0) return;

    const { error: reversalError } = await supabase.rpc(
      "record_promoter_ledger_entry",
      {
        p_promoter_id: earning.promoter_id,
        p_order_id: orderId,
        p_entry_type: "reversal",
        p_amount_cents: -earning.amount_cents,
        p_currency: earning.currency || "usd",
        p_stripe_transfer_id: stripeTransferId,
      },
    );
    if (reversalError) {
      console.error(
        "[stripe-webhook] promoter reversal error:",
        reversalError,
      );
      return;
    }
    console.log(
      `[stripe-webhook] promoter reversal recorded for order ${orderId} (−${earning.amount_cents}¢)`,
    );
  } catch (err) {
    console.error("[stripe-webhook] recordPromoterReversal failed:", err);
  }
}
