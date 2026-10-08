/**
 * node --test packages/app/lib/payments/checkout-sheet-totals.test.ts
 *
 * The web CheckoutSheet took the promo off the pre-promoter subtotal while
 * ticket-checkout takes it off the post-promoter one. 20% promoter + 10%
 * promo on $100 showed $70 in the sheet; the server charged $72.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { computeCheckoutSheetTotals } from "./checkout-sheet-totals.ts";
import { computeStackedAdmissionDiscount } from "./promo-discount.ts";

test("20% promoter + 10% promo on $100 previews $72, the amount the server charges", () => {
  const t = computeCheckoutSheetTotals({
    admissionSubtotalCents: 10000,
    quantity: 1,
    promoterDiscountBps: 2000,
    promo: { type: "percent", value: 10 },
  });
  assert.equal(t.promoterDiscountCents, 2000);
  assert.equal(t.promoDiscountCents, 800);
  assert.equal(t.goodsCents, 7200);
});

test("promoter discount floors like computePromoterCommission (999 at 15% -> 149 off)", () => {
  const d = computeStackedAdmissionDiscount({
    subtotalCents: 999, promoterDiscountBps: 1500, quantity: 3,
  });
  assert.equal(d.promoterDiscountCents, 149);
  assert.equal(d.discountedSubtotalCents, 850);
});

test("fixed promo after promoter matches payment-safety's stacked case ($50, 10%, $5 off -> $40)", () => {
  const t = computeCheckoutSheetTotals({
    admissionSubtotalCents: 5000, quantity: 1, promoterDiscountBps: 1000,
    promo: { type: "fixed_cents", value: 500 },
  });
  assert.equal(t.goodsCents, 4000);
});

test("cart review: promoter applies to admission only, promo to the remaining cart", () => {
  const d = computeStackedAdmissionDiscount({
    subtotalCents: 12000, admissionSubtotalCents: 10000, promoterDiscountBps: 2000,
    promo: { type: "percent", value: 10 }, quantity: 1,
  });
  assert.equal(d.promoterDiscountCents, 2000);
  assert.equal(d.promoDiscountCents, 1000);
  assert.equal(d.discountedSubtotalCents, 9000);
});

test("buyer fee is computed on the discounted goods", () => {
  const t = computeCheckoutSheetTotals({ admissionSubtotalCents: 2500, quantity: 1, promoterDiscountBps: 0 });
  assert.equal(t.totalCents, t.goodsCents + t.feeCents);
  assert.ok(t.feeCents > 0);
  const free = computeCheckoutSheetTotals({ admissionSubtotalCents: 1000, quantity: 1, promoterDiscountBps: 10000 });
  assert.equal(free.totalCents, 0);
});
