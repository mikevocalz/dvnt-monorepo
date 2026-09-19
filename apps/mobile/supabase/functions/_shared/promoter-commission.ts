/**
 * Promoter commission calculation (Phase 2, policy v2).
 *
 * Basis: eligible ticket subtotal AFTER the promoter discount,
 * BEFORE organizer and processing fees. Integer cents only, basis points
 * for all rates.
 *
 * Multi-line orders allocate the discount and commission per line with a
 * deterministic remainder rule: the rounded-down allocation is computed for
 * each line, then any remaining cents are distributed one cent at a time
 * to the earliest lines until the order-level total is reached.
 */

export interface CommissionLine {
  /** Eligible subtotal for this line in cents. */
  eligibleAmountCents: number;
  /** Optional quantity for debugging / display. Does not affect math. */
  quantity?: number;
}

export interface PromoterCommissionInput {
  lines: CommissionLine[];
  customerDiscountBps: number;
  promoterCommissionBps: number;
  /** Rounding rule for fractional cents. */
  roundingRule?: "floor";
}

export interface CommissionLineResult {
  eligibleAmountCents: number;
  discountAmountCents: number;
  discountedAmountCents: number;
  commissionAmountCents: number;
  quantity: number;
}

export interface PromoterCommissionOutput {
  /** Sum of line eligible amounts. */
  originalAmountCents: number;
  /** Total customer discount across all lines. */
  discountAmountCents: number;
  /** Eligible subtotal after discount. */
  discountedAmountCents: number;
  /** Total promoter commission across all lines. */
  commissionAmountCents: number;
  /** Per-line allocation. */
  lines: CommissionLineResult[];
}

function assertIntegerCents(n: number, name: string): void {
  if (!Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a non-negative integer (cents), got ${n}`);
  }
}

function assertPositiveInteger(n: number, name: string): void {
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`${name} must be a positive integer, got ${n}`);
  }
}

function assertBps(n: number, name: string): void {
  if (!Number.isInteger(n) || n < 0 || n > 10000) {
    throw new Error(`${name} must be an integer basis point 0-10000, got ${n}`);
  }
}

function lineTotal(line: CommissionLine): number {
  const qty = Number.isInteger(line.quantity) && line.quantity! > 0
    ? line.quantity!
    : 1;
  return line.eligibleAmountCents * qty;
}

function allocateRemainder(
  target: number,
  perUnitFloors: number[],
): number[] {
  const floors = perUnitFloors.map((x) => Math.max(0, x));
  const allocated = floors.reduce((s, v) => s + v, 0);
  let remainder = target - allocated;
  if (remainder < 0) {
    // Defensive: floors should never exceed the target. If they do,
    // truncate from the end so the total still matches.
    remainder = 0;
  }
  const result = [...floors];
  for (let i = 0; i < result.length && remainder > 0; i++) {
    result[i] += 1;
    remainder -= 1;
  }
  return result;
}

export function computePromoterCommission(
  input: PromoterCommissionInput,
): PromoterCommissionOutput {
  const customerDiscountBps = input.customerDiscountBps;
  const promoterCommissionBps = input.promoterCommissionBps;
  assertBps(customerDiscountBps, "customerDiscountBps");
  assertBps(promoterCommissionBps, "promoterCommissionBps");

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error("lines must be a non-empty array");
  }

  const lines = input.lines.map((line) => {
    assertIntegerCents(line.eligibleAmountCents, "eligibleAmountCents");
    if (line.quantity !== undefined) {
      assertPositiveInteger(line.quantity, "quantity");
    }
    return line;
  });

  const lineTotals = lines.map(lineTotal);

  const originalAmountCents = lineTotals.reduce((sum, total) => sum + total, 0);

  const discountAmountCents = Math.floor(
    (originalAmountCents * customerDiscountBps) / 10000,
  );

  const lineDiscountFloors = lineTotals.map((total) =>
    Math.floor((total * customerDiscountBps) / 10000),
  );
  const lineDiscounts = allocateRemainder(discountAmountCents, lineDiscountFloors);

  const lineDiscountedAmounts = lineTotals.map(
    (total, i) => total - lineDiscounts[i],
  );

  const discountedAmountCents = lineDiscountedAmounts.reduce((s, v) => s + v, 0);

  const commissionAmountCents = Math.floor(
    (discountedAmountCents * promoterCommissionBps) / 10000,
  );

  const lineCommissionFloors = lineDiscountedAmounts.map((amount) =>
    Math.floor((amount * promoterCommissionBps) / 10000),
  );
  const lineCommissions = allocateRemainder(
    commissionAmountCents,
    lineCommissionFloors,
  );

  return {
    originalAmountCents,
    discountAmountCents,
    discountedAmountCents,
    commissionAmountCents,
    lines: lines.map((line, i) => ({
      eligibleAmountCents: lineTotals[i],
      discountAmountCents: lineDiscounts[i],
      discountedAmountCents: lineDiscountedAmounts[i],
      commissionAmountCents: lineCommissions[i],
      quantity: Number.isInteger(line.quantity) && line.quantity! > 0 ? line.quantity! : 1,
    })),
  };
}
