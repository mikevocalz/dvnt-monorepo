/**
 * Shared helper: validate a promoter code and return its locked discount /
 * commission policy.
 *
 * A promoter code is an event_promoters row. It gives the buyer a customer
 * discount and, when the order is paid, attributes the sale so the promoter
 * earns commission on the post-discount eligible subtotal. Distinct from
 * promo_codes: the same code string can live in both tables, but this helper
 * only reads event_promoters.
 */

import {
  computePromoterCommission,
  type CommissionLine,
} from "./promoter-commission.ts";

export interface PromoterCodeResult {
  promoter_id: string;
  code: string;
  customer_discount_bps: number;
  promoter_commission_bps: number;
  /** Discount amount in cents for the provided eligible subtotal. */
  discount_cents: number;
  /** Commissionable eligible subtotal after discount. */
  discounted_amount_cents: number;
  /** Expected promoter commission in cents for this allocation. */
  commission_cents: number;
}

export async function validateAndApplyPromoterCode(
  supabase: any,
  eventId: number,
  code: string,
  eligibleAmountCents: number,
  quantity?: number,
): Promise<{ result: PromoterCodeResult | null; error: string | null }> {
  if (!code || !code.trim()) {
    return { result: null, error: null };
  }

  const normalizedCode = code.trim().toUpperCase();

  const { data: promoter, error } = await supabase
    .from("event_promoters")
    .select("id, code, customer_discount_bps, promoter_commission_bps, status")
    .eq("event_id", eventId)
    .ilike("code", normalizedCode)
    .eq("status", "active")
    .maybeSingle();

  if (error) {
    console.error("[apply-promoter-code] lookup error:", error);
    return { result: null, error: "Promoter code lookup failed" };
  }
  if (!promoter) {
    return { result: null, error: "Invalid promoter code" };
  }

  const lines: CommissionLine[] = [{
    eligibleAmountCents,
    quantity,
  }];

  const commission = computePromoterCommission({
    lines,
    customerDiscountBps: promoter.customer_discount_bps,
    promoterCommissionBps: promoter.promoter_commission_bps,
  });

  return {
    result: {
      promoter_id: promoter.id,
      code: promoter.code,
      customer_discount_bps: promoter.customer_discount_bps,
      promoter_commission_bps: promoter.promoter_commission_bps,
      discount_cents: commission.discountAmountCents,
      discounted_amount_cents: commission.discountedAmountCents,
      commission_cents: commission.commissionAmountCents,
    },
    error: null,
  };
}
