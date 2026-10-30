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

test("free tickets never carry buyer, organizer or platform fees", () => {
  for (const quantity of [1, 3, 100]) {
    const f = computeFees(0, quantity);
    assert.equal(f.buyer_fee, 0);
    assert.equal(f.organizer_fee, 0);
    assert.equal(f.application_fee_amount, 0);
    assert.equal(f.customer_charge_amount, 0);
    assert.equal(f.organizer_transfer_amount, 0);
  }
});
