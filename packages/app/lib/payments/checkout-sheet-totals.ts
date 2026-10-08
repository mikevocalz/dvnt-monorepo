/**
 * Totals for the web event-detail CheckoutSheet, the screen before
 * checkout-review. Pure so node:test can pin it against the server's order:
 * promoter discount, then promo code, then add-ons, then the buyer fee.
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
  const discount = computeStackedAdmissionDiscount({
    subtotalCents: input.admissionSubtotalCents,
    promoterDiscountBps: input.promoterDiscountBps,
    promo: input.promo,
    quantity: input.quantity,
  });
  const goodsCents =
    discount.discountedSubtotalCents + Math.max(0, input.addonCents ?? 0);
  const feeCents =
    goodsCents > 0 ? computeFees(goodsCents, input.quantity).buyer_fee : 0;
  return {
    promoterDiscountCents: discount.promoterDiscountCents,
    promoDiscountCents: discount.promoDiscountCents,
    goodsCents,
    feeCents,
    totalCents: goodsCents + feeCents,
  };
}
