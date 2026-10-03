/**
 * node --test packages/app/lib/payments/checkout-promo.test.ts
 *
 * Production 2026-10-03: RON15 was validated on the event 80 cart, the buyer
 * then built a cart for event 85, and the review screen still showed
 * "15% off applied". cart-checkout answered 400 "Invalid promo code" (RON15
 * only exists for event 80) about 20 times, and the buyer saw nothing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isPromoCheckoutError,
  promoForCart,
  type ScopedPromo,
} from "./checkout-promo.ts";

const ron15: ScopedPromo = {
  type: "percent",
  value: 15,
  code: "RON15",
  eventId: "80",
};

test("a promo validated for one event does not apply to another event's cart", () => {
  assert.equal(promoForCart(ron15, "85"), null);
});

test("a promo applies to the cart of the event it was validated for", () => {
  assert.deepEqual(promoForCart(ron15, "80"), ron15);
});

test("no cart means no promo", () => {
  assert.equal(promoForCart(ron15, undefined), null);
  assert.equal(promoForCart(ron15, null), null);
  assert.equal(promoForCart(null, "80"), null);
});

test("every promo rejection from apply-promo-code.ts is a promo error", () => {
  for (const message of [
    "Invalid promo code",
    "Promo code not valid for this ticket type",
    "Promo code is not yet active",
    "Promo code has expired",
    "Promo code has been fully redeemed",
    "You've already used this code.",
  ]) {
    assert.equal(isPromoCheckoutError(message), true, message);
  }
});

test("promoter-code and unrelated checkout errors are not promo errors", () => {
  for (const message of [
    "Invalid promoter code",
    "Promoter code lookup failed",
    "Cart hold expired",
    "Edge function error",
    "",
  ]) {
    assert.equal(isPromoCheckoutError(message), false, message);
  }
});
