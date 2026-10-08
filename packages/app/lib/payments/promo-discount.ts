/**
 * promo-discount — client-side MIRROR of the server's discount math in
 * supabase/functions/_shared/apply-promo-code.ts. Used ONLY to show the buyer a
 * discount line + adjusted total before they pay. The server
 * (create-payment-intent → validateAndApplyPromo) re-validates and is the
 * authoritative source for the actual charge — keep this in sync with it.
 */
export type PromoDiscountType = "percent" | "fixed_cents" | "bogo";

/** Discount in cents for a validated promo, matching the edge fn exactly. */
export function computePromoDiscountCents(
  type: PromoDiscountType,
  value: number,
  subtotalCents: number,
  quantity: number,
): number {
  let discount = 0;
  if (type === "percent") {
    discount = Math.round(subtotalCents * (value / 100));
  } else if (type === "bogo") {
    // Buy-one-get-one: every 2nd ticket free. unit = subtotal / quantity.
    const qty = Math.max(1, quantity);
    const unit = Math.round(subtotalCents / qty);
    discount = Math.floor(qty / 2) * unit;
  } else {
    discount = value; // fixed_cents
  }
  return Math.min(Math.max(0, discount), subtotalCents);
}

/** Buyer-facing label for a promo, e.g. "Buy one, get one" / "20% off". */
export function promoLabel(type: PromoDiscountType, value: number): string {
  if (type === "bogo") return "Buy one, get one";
  if (type === "percent") return `${value}% off`;
  return `$${(value / 100).toFixed(2)} off`;
}

export interface StackedAdmissionDiscountInput {
  /** Pre-discount subtotal the promo code applies to (admission, or cart). */
  subtotalCents: number;
  /** Admission-only subtotal the promoter discount applies to. Defaults to subtotalCents. */
  admissionSubtotalCents?: number;
  /** Promoter customer discount, basis points 0-10000. */
  promoterDiscountBps: number;
  /** Validated promo code, if any. */
  promo?: { type: PromoDiscountType; value: number } | null;
  quantity: number;
}

export interface StackedAdmissionDiscount {
  promoterDiscountCents: number;
  promoDiscountCents: number;
  /** subtotalCents minus both discounts, never below 0. */
  discountedSubtotalCents: number;
}

/**
 * Promoter discount first, then the promo code on what is left: the order
 * ticket-checkout and cart-checkout charge in. The promoter part floors to
 * whole cents like computePromoterCommission on the server.
 * 20% promoter + 10% promo on $100 is $100 - $20 = $80, then - $8 = $72.
 */
export function computeStackedAdmissionDiscount(
  input: StackedAdmissionDiscountInput,
): StackedAdmissionDiscount {
  const subtotal = Math.max(0, input.subtotalCents);
  const admission = Math.max(0, input.admissionSubtotalCents ?? subtotal);
  const bps = Math.max(0, Math.min(10000, input.promoterDiscountBps || 0));
  const promoterDiscountCents = Math.min(
    admission,
    Math.floor((admission * bps) / 10000),
  );
  const afterPromoter = Math.max(0, subtotal - promoterDiscountCents);
  const promoDiscountCents = input.promo
    ? computePromoDiscountCents(
        input.promo.type,
        input.promo.value,
        afterPromoter,
        input.quantity,
      )
    : 0;
  return {
    promoterDiscountCents,
    promoDiscountCents,
    discountedSubtotalCents: Math.max(0, afterPromoter - promoDiscountCents),
  };
}
