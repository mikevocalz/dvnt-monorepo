import test from "node:test";
import assert from "node:assert/strict";
import { computePromoterCommission } from "./promoter-commission.ts";

// Canonical case from the payments prompt:
// $50.00 tier, ANDRE applied, 10% customer discount, 10% promoter commission.
// Discount: 500, paid eligible subtotal: 4500, commission: 450.
test("canonical case: 5000 subtotal, 10% discount, 10% commission", () => {
  const result = computePromoterCommission({
    lines: [{ eligibleAmountCents: 5000 }],
    customerDiscountBps: 1000,
    promoterCommissionBps: 1000,
  });

  assert.equal(result.originalAmountCents, 5000);
  assert.equal(result.discountAmountCents, 500);
  assert.equal(result.discountedAmountCents, 4500);
  assert.equal(result.commissionAmountCents, 450);
  assert.equal(result.lines.length, 1);
  assert.equal(result.lines[0].discountAmountCents, 500);
  assert.equal(result.lines[0].commissionAmountCents, 450);
});

// Remainder allocation must be deterministic and sum exactly.
test("quantity 7 at odd prices allocates discount and commission deterministically", () => {
  const result = computePromoterCommission({
    lines: [{ eligibleAmountCents: 777, quantity: 7 }],
    customerDiscountBps: 1000,
    promoterCommissionBps: 1000,
  });

  const totalEligible = 777 * 7; // 5439
  assert.equal(result.originalAmountCents, totalEligible);
  assert.equal(result.discountAmountCents, Math.floor(totalEligible * 0.1));
  assert.equal(result.discountedAmountCents, totalEligible - result.discountAmountCents);
  assert.equal(result.commissionAmountCents, Math.floor(result.discountedAmountCents * 0.1));

  const lineDiscountSum = result.lines.reduce((s, l) => s + l.discountAmountCents, 0);
  const lineCommissionSum = result.lines.reduce((s, l) => s + l.commissionAmountCents, 0);
  assert.equal(lineDiscountSum, result.discountAmountCents);
  assert.equal(lineCommissionSum, result.commissionAmountCents);
});

// No discount means no discount and commission on full eligible amount.
test("zero customer discount still pays commission on full subtotal", () => {
  const result = computePromoterCommission({
    lines: [{ eligibleAmountCents: 10000 }],
    customerDiscountBps: 0,
    promoterCommissionBps: 1000,
  });

  assert.equal(result.originalAmountCents, 10000);
  assert.equal(result.discountAmountCents, 0);
  assert.equal(result.discountedAmountCents, 10000);
  assert.equal(result.commissionAmountCents, 1000);
});

// Multiple lines with a remainder: extra cents go to earlier lines.
test("multi-line order allocates remainder to first lines", () => {
  const result = computePromoterCommission({
    lines: [
      { eligibleAmountCents: 333 },
      { eligibleAmountCents: 333 },
      { eligibleAmountCents: 334 },
    ],
    customerDiscountBps: 1000, // 10% => 100 discount total
    promoterCommissionBps: 1000,
  });

  const expectedDiscount = Math.floor(
    (333 + 333 + 334) * 0.1,
  );
  assert.equal(result.discountAmountCents, expectedDiscount);
  assert.equal(result.discountedAmountCents, 1000 - expectedDiscount);
  assert.equal(result.commissionAmountCents, Math.floor(result.discountedAmountCents * 0.1));
  assert.equal(
    result.lines.reduce((s, l) => s + l.discountAmountCents, 0),
    result.discountAmountCents,
  );
  assert.equal(
    result.lines.reduce((s, l) => s + l.commissionAmountCents, 0),
    result.commissionAmountCents,
  );
  // Remainder should be allocated to earlier lines.
  const discountByLine = result.lines.map((l) => l.discountAmountCents);
  assert.deepEqual(discountByLine, [34, 33, 33]);
});

// Invalid inputs reject rather than silently produce wrong cents.
test("rejects negative or out-of-range basis points", () => {
  assert.throws(() =>
    computePromoterCommission({
      lines: [{ eligibleAmountCents: 1000 }],
      customerDiscountBps: -1,
      promoterCommissionBps: 1000,
    })
  );
  assert.throws(() =>
    computePromoterCommission({
      lines: [{ eligibleAmountCents: 1000 }],
      customerDiscountBps: 1000,
      promoterCommissionBps: 10001,
    })
  );
});

test("rejects negative eligible amounts", () => {
  assert.throws(() =>
    computePromoterCommission({
      lines: [{ eligibleAmountCents: -100 }],
      customerDiscountBps: 0,
      promoterCommissionBps: 0,
    })
  );
});
