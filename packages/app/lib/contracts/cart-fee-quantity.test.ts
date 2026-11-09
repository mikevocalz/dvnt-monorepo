import test from "node:test";
import assert from "node:assert/strict";
import { calculateCartFeeQuantity } from "./invariants.ts";
test("cart review fee quantity excludes zero-price tickets and add-ons", () => {
  assert.equal(calculateCartFeeQuantity([{unitPriceCents:0,quantity:3},{unitPriceCents:1000,quantity:2},{unitPriceCents:0,quantity:1}]),2);
});
test("paid-only cart fee quantity is unchanged and all-free is zero", () => {
  assert.equal(calculateCartFeeQuantity([{unitPriceCents:2500,quantity:3}]),3);
  assert.equal(calculateCartFeeQuantity([{unitPriceCents:0,quantity:10}]),0);
});
