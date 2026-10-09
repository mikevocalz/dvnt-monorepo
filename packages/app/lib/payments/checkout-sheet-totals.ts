/**
 * Totals for the web event-detail CheckoutSheet, the screen before
 * checkout-review. Pure so node:test can pin it against the server's order:
 * promoter discount on admission, then the promo code on the rest of the
 * cart including add-ons, then the buyer fee.
 */
import { computeFees } from "../stripe/fee-calculator.ts";
import {
  computeStackedAdmissionDiscount,
  type PromoDiscountType,
} from "./promo-discount.ts";

export interface CheckoutSheetTotalsInput {
  admissionSubtotalCents: number;
  quantity: number;
  promoterDiscountBps: number;
  promo?: { type: PromoDiscountType; value: number } | null;
  addonCents?: number;
  /** Add-on units selected. They count toward the per-unit fee. */
  addonQuantity?: number;
}

export interface CheckoutSheetTotals {
  promoterDiscountCents: number;
  promoDiscountCents: number;
  goodsCents: number;
  feeCents: number;
  totalCents: number;
}

export function computeCheckoutSheetTotals(
  input: CheckoutSheetTotalsInput,
): CheckoutSheetTotals {
  // With add-ons the sheet hands off to cart-checkout: the promoter discount
  // comes off admission, the promo off the rest of the cart (add-ons
  // included), and the per-unit fee counts every unit.
  const addonCents = Math.max(0, input.addonCents ?? 0);
  const units = input.quantity + Math.max(0, input.addonQuantity ?? 0);
  const discount = computeStackedAdmissionDiscount({
    subtotalCents: input.admissionSubtotalCents + addonCents,
    admissionSubtotalCents: input.admissionSubtotalCents,
    promoterDiscountBps: input.promoterDiscountBps,
    promo: input.promo,
    quantity: units,
  });
  const goodsCents = discount.discountedSubtotalCents;
  const feeCents =
    goodsCents > 0 ? computeFees(goodsCents, Math.max(1, units)).buyer_fee : 0;
  return {
    promoterDiscountCents: discount.promoterDiscountCents,
    promoDiscountCents: discount.promoDiscountCents,
    goodsCents,
    feeCents,
    totalCents: goodsCents + feeCents,
  };
}
