/**
 * checkout-promo: scoping and error classification for the promo field on
 * the cart review screen. Promo codes belong to one event (promo_codes.event_id),
 * so a code validated against one cart must never carry over to another
 * event's cart: cart-checkout rejects it with "Invalid promo code".
 */
import type { PromoDiscountType } from "./promo-discount.ts";

export type ScopedPromo = {
  type: PromoDiscountType;
  value: number;
  code: string;
  /** Event the code was validated against (validate-promo-code event_id). */
  eventId: string;
};

/** The applied promo only when it was validated for this cart's event. */
export function promoForCart(
  promo: ScopedPromo | null,
  cartEventId: string | null | undefined,
): ScopedPromo | null {
  if (!promo || !cartEventId) return null;
  return String(promo.eventId) === String(cartEventId) ? promo : null;
}

/**
 * Rejections from validateAndApplyPromo in
 * apps/mobile/supabase/functions/_shared/apply-promo-code.ts. Exact strings,
 * so "Invalid promoter code" (apply-promoter-code.ts) is not mistaken for one.
 */
const PROMO_ERRORS = new Set(
  [
    "Invalid promo code",
    "Promo code not valid for this ticket type",
    "Promo code is not yet active",
    "Promo code has expired",
    "Promo code has been fully redeemed",
    "You've already used this code.",
  ].map((m) => m.toLowerCase()),
);

export function isPromoCheckoutError(message: string): boolean {
  return PROMO_ERRORS.has(message.trim().toLowerCase());
}
