import test from "node:test";
import assert from "node:assert/strict";
import { computeFees } from "./fee-calculator.ts";

// The number three real buyers were charged on 2026-09-18 for event 79's
// $25.00 General Admission. The checkout sheet quoted "Pay $25.00" and Stripe
// debited $26.63, because the sheet added no fee and checkout-review did. This
// pins the charge so the two screens cannot quote different prices again.
test("a $25 ticket is charged $26.63, and the fee is the difference", () => {
  const f = computeFees(2500, 1);
  assert.equal(f.buyer_fee, 163, "2.5% of 2500 = 63, plus $1.00 per ticket");
  assert.equal(f.customer_charge_amount, 2663);
  assert.equal(f.customer_charge_amount, 2500 + f.buyer_fee);
});

test("the per-ticket part of the fee scales with quantity", () => {
  // The two-ticket order on the same event settled at 5325.
  const f = computeFees(5000, 2);
  assert.equal(f.customer_charge_amount, 5325);
  assert.equal(f.buyer_fee, 325, "2.5% of 5000 = 125, plus $1.00 x 2");
});

test("a free ticket is still charged a $1 service fee — deliberate or not, it is what ships", () => {
  // Reachable when a $0 admission rides the cart rail (free tier plus an
  // add-on, or a 100%-off promo). Recording the behaviour rather than
  // asserting it is correct: a "Free" tier that totals $1.00 is a product
  // decision, and this test is where it surfaces if someone changes it.
  const f = computeFees(0, 1);
  assert.equal(f.buyer_fee, 100);
  assert.equal(f.customer_charge_amount, 100);
});
