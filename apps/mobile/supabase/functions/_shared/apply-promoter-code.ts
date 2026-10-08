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

export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
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
  // ilike is a pattern match: escape % _ and \ so a code like TRE_1 only
  // matches itself, not TREX1. Matching stays case-insensitive.
  const codePattern = escapeLikePattern(normalizedCode);

  const { data: promoter, error } = await supabase
    .from("event_promoters")
    .select("id, code, customer_discount_bps, promoter_commission_bps, status")
    .eq("event_id", eventId)
    .ilike("code", codePattern)
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
    // This argument is already the entire eligible subtotal, not a unit price.
    quantity: 1,
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


/**
 * Resolve an account-bound tracked promoter code for checkout.
 *
 * A saved claim is never trusted on its own: the linked promoter must still
 * belong to this event and be active. If the promoter was paused/removed, the
 * stale claim is ignored and checkout continues without a promoter discount.
 */
export async function resolveAccountPromoterCode(
  supabase: any,
  eventId: number,
  buyerAuthId: string | null | undefined,
): Promise<string | null> {
  if (!buyerAuthId || !Number.isInteger(eventId) || eventId <= 0) return null;

  const { data: claim, error: claimError } = await supabase
    .from("promoter_ref_claims")
    .select("promoter_id")
    .eq("buyer_auth_id", buyerAuthId)
    .eq("event_id", eventId)
    .maybeSingle();

  if (claimError) {
    // Forward-compatible deploy ordering: older databases without the claims
    // table still check out normally; tracked refs continue riding the request.
    if (claimError.code !== "42P01") {
      console.error("[apply-promoter-code] account claim lookup error:", claimError);
    }
    return null;
  }
  if (!claim?.promoter_id) return null;

  const { data: promoter, error: promoterError } = await supabase
    .from("event_promoters")
    .select("code")
    .eq("id", claim.promoter_id)
    .eq("event_id", eventId)
    .eq("status", "active")
    .maybeSingle();

  if (promoterError) {
    console.error("[apply-promoter-code] claimed promoter lookup error:", promoterError);
    return null;
  }

  const code = String(promoter?.code || "").trim().toUpperCase().slice(0, 32);
  return /^[A-Z0-9_-]{2,32}$/.test(code) ? code : null;
}
