/**
 * Order money-state + promoter ledger helpers shared between the Stripe
 * webhook and the reconcile-orders sweep. Extracted verbatim from
 * stripe-webhook/index.ts.
 */

import { computePromoterCommission } from "./promoter-commission.ts";
import { computeLockedPromoterEarning } from "./promoter-earning.ts";

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

// ── Promoter economy (WS-4 / Phase 2) ─────────────────────────────────
// LEDGER BASE v2: a promoter's earning is computed by the canonical
// `computePromoterCommission` helper. Basis is the eligible ticket
// subtotal AFTER the promoter discount, BEFORE organizer and processing
// fees. The result is locked per order and never recomputed from current
// settings. Integer cents only.
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

    // Locked policy single source of truth = the attribution row.
    // On replay the RPC returns current bps if the row exists, so we still
    // read the persisted locked values from the table.
    const { data: locked } = await supabase
      .from("promoter_attributions")
      .select(
        "promoter_id, locked_rev_share_bps, locked_customer_discount_bps, locked_promoter_commission_bps",
      )
      .eq("order_id", orderId)
      .maybeSingle();
    if (!locked?.promoter_id) return;

    const { data: order } = await supabase
      .from("orders")
      .select(
        "subtotal_cents, organizer_fee_cents, quantity, promoter_original_amount_cents, promoter_customer_discount_bps, promoter_commission_bps, promoter_commission_amount_cents",
      )
      .eq("id", orderId)
      .maybeSingle();
    if (!order) return;

    // Pure helper: locked amount → Phase 2 snapshot → legacy organizer-net.
    let earningCents = computeLockedPromoterEarning({
      promoterCommissionAmountCents: order.promoter_commission_amount_cents,
      promoterOriginalAmountCents: order.promoter_original_amount_cents,
      promoterCustomerDiscountBps: order.promoter_customer_discount_bps,
      promoterCommissionBps: order.promoter_commission_bps,
      subtotalCents: order.subtotal_cents,
      organizerFeeCents: order.organizer_fee_cents,
      quantity: order.quantity,
      lockedRevShareBps: locked.locked_rev_share_bps,
      lockedCustomerDiscountBps: locked.locked_customer_discount_bps,
      lockedPromoterCommissionBps: locked.locked_promoter_commission_bps,
    });

    // If we derived the earning from a v2 snapshot and had no locked
    // commission amount, persist the computed snapshot back to the order
    // and attribution row so later webhook replays and payouts read it.
    if (
      earningCents != null &&
      earningCents > 0 &&
      !Number.isInteger(order.promoter_commission_amount_cents) &&
      Number.isInteger(order.promoter_original_amount_cents)
    ) {
      try {
        const commission = computePromoterCommission({
          lines: [{
            eligibleAmountCents: order.promoter_original_amount_cents as number,
            quantity:
              Number.isInteger(order.quantity) && order.quantity > 0
                ? order.quantity
                : 1,
          }],
          customerDiscountBps:
            (order.promoter_customer_discount_bps as number) ??
              locked.locked_customer_discount_bps,
          promoterCommissionBps:
            (order.promoter_commission_bps as number) ??
              locked.locked_promoter_commission_bps,
        });
        await supabase
          .from("orders")
          .update({
            promoter_policy_version: "v2_eligible_subtotal_after_discount",
            promoter_discount_amount_cents: commission.discountAmountCents,
            promoter_discounted_amount_cents: commission.discountedAmountCents,
            promoter_commission_amount_cents: commission.commissionAmountCents,
          })
          .eq("id", orderId);
        await supabase
          .from("promoter_attributions")
          .update({
            locked_customer_discount_bps: commission.lines[0]
              ? order.promoter_customer_discount_bps ??
                locked.locked_customer_discount_bps
              : null,
            locked_promoter_commission_bps: commission.lines[0]
              ? order.promoter_commission_bps ??
                locked.locked_promoter_commission_bps
              : null,
            locked_promoter_discount_amount_cents: commission.discountAmountCents,
            locked_promoter_commission_amount_cents: commission.commissionAmountCents,
          })
          .eq("order_id", orderId);
      } catch {
        // Persistence is best-effort; the earning is still correct for this
        // webhook invocation.
      }
    }

    if (!Number.isInteger(earningCents) || earningCents! <= 0) return;

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
      `[stripe-webhook] promoter earning ${ledger?.applied ? "recorded" : "already recorded"}: order ${orderId}, ${earningCents}¢`,
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
