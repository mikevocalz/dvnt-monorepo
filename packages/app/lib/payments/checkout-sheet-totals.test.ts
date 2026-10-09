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

// With add-ons selected the sheet hands off to cart-checkout, which takes the
// promo off (tickets + add-ons - promoter discount) and charges the per-unit
// fee on every unit, add-ons included. The sheet showed a lower total.
test("with a coat check the sheet previews what cart-checkout charges", () => {
  const t = computeCheckoutSheetTotals({
    admissionSubtotalCents: 5000, quantity: 2, promoterDiscountBps: 1000,
    promo: { type: "percent", value: 10 }, addonCents: 1000, addonQuantity: 1,
  });
  // promoter 10% of 5000 = 500; promo 10% of (6000 - 500) = 550.
  assert.equal(t.promoterDiscountCents, 500);
  assert.equal(t.promoDiscountCents, 550);
  assert.equal(t.goodsCents, 4950);
  // 2.5% of 4950 rounds to 124, plus $1 for each of the 3 units.
  assert.equal(t.feeCents, 124 + 300);
});
