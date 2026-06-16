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
