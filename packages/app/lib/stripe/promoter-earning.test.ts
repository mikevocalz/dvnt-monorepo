import test from "node:test";
import assert from "node:assert/strict";
import { computeLockedPromoterEarning } from "./promoter-earning.ts";
import { computeFees } from "./fee-calculator.ts";

test("uses locked commission amount when already present", () => {
  const result = computeLockedPromoterEarning({
    promoterCommissionAmountCents: 450,
    promoterOriginalAmountCents: 5000,
    promoterCustomerDiscountBps: 1000,
    promoterCommissionBps: 1000,
  });
  assert.equal(result, 450);
});

test("canonical case: 5000 subtotal, 10% discount, 10% commission = 450", () => {
  const result = computeLockedPromoterEarning({
    promoterOriginalAmountCents: 5000,
    promoterCustomerDiscountBps: 1000,
    promoterCommissionBps: 1000,
    quantity: 1,
  });
  assert.equal(result, 450);
});

test("uses attribution-locked bps when order snapshot is partial", () => {
  const result = computeLockedPromoterEarning({
    promoterOriginalAmountCents: 5000,
    lockedCustomerDiscountBps: 1000,
    lockedPromoterCommissionBps: 1000,
    quantity: 1,
  });
  assert.equal(result, 450);
});

test("zero customer discount still pays commission on full subtotal", () => {
  const result = computeLockedPromoterEarning({
    promoterOriginalAmountCents: 5000,
    promoterCustomerDiscountBps: 0,
    promoterCommissionBps: 1000,
    quantity: 1,
  });
  assert.equal(result, 500);
});

test("legacy organizer-net basis when no Phase 2 snapshot", () => {
  const subtotal = 5000;
  const quantity = 1;
  const fees = computeFees(subtotal, quantity);
  const organizerNet = fees.organizer_transfer_amount;
  const result = computeLockedPromoterEarning({
    subtotalCents: subtotal,
    organizerFeeCents: fees.organizer_fee,
    quantity,
    lockedRevShareBps: 1000,
  });
  assert.equal(result, Math.floor((organizerNet * 1000) / 10000));
});

test("legacy fallback recomputes fees when organizer fee is missing", () => {
  const subtotal = 5000;
  const quantity = 1;
  const fees = computeFees(subtotal, quantity);
  const organizerNet = fees.organizer_transfer_amount;
  const result = computeLockedPromoterEarning({
    subtotalCents: subtotal,
    quantity,
    lockedRevShareBps: 1000,
  });
  assert.equal(result, Math.floor((organizerNet * 1000) / 10000));
});

test("returns null when there is no basis for an earning", () => {
  const result = computeLockedPromoterEarning({
    subtotalCents: 0,
    organizerFeeCents: 0,
    quantity: 1,
    lockedRevShareBps: 1000,
  });
  assert.equal(result, null);
});

test("returns null when locked rev share is zero or missing in legacy mode", () => {
  const result = computeLockedPromoterEarning({
    subtotalCents: 5000,
    organizerFeeCents: 200,
    quantity: 1,
    lockedRevShareBps: 0,
  });
  assert.equal(result, null);
});

test("multi-ticket snapshot is not multiplied by quantity again", () => {
  assert.equal(computeLockedPromoterEarning({
    promoterOriginalAmountCents: 10000,
    promoterCustomerDiscountBps: 1000,
    promoterCommissionBps: 1000,
    quantity: 2,
  }), 900);
});

test("historical locked commission is preserved even if its policy changes", () => {
  assert.equal(computeLockedPromoterEarning({
    promoterCommissionAmountCents: 1234,
    promoterOriginalAmountCents: 10000,
    promoterCustomerDiscountBps: 0,
    promoterCommissionBps: 500,
    quantity: 2,
  }), 1234);
});
