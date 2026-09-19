/**
 * Promoter earning computation for an already-attributed paid order.
 *
 * This is the pure decision logic used by recordPromoterEarning. It returns
 * the locked earning in cents, or null when no earning can be computed.
 *
 * Priority:
 * 1. If the order already has a locked `promoterCommissionAmountCents`, use it.
 * 2. Else if Phase 2 snapshot fields are present, compute with the canonical
 *    `computePromoterCommission` helper.
 * 3. Else fall back to the legacy organizer-net basis (locked_rev_share_bps
 *    × (subtotal − organizer_fee)).
 */

import { computeFees } from "./fee-calculator.ts";
import { computePromoterCommission } from "./promoter-commission.ts";

export interface PromoterEarningInput {
  /** Locked commission already written on the order. */
  promoterCommissionAmountCents?: number | null;
  /** Original eligible subtotal before the promoter discount. */
  promoterOriginalAmountCents?: number | null;
  /** Customer discount rate used for the order. */
  promoterCustomerDiscountBps?: number | null;
  /** Promoter commission rate used for the order. */
  promoterCommissionBps?: number | null;
  /** Fallback: order subtotal for legacy organizer-net basis. */
  subtotalCents?: number | null;
  /** Fallback: organizer fee for legacy organizer-net basis. */
  organizerFeeCents?: number | null;
  /** Quantity for fee calculation and per-line allocation. */
  quantity?: number | null;
  /** Fallback: locked rev share from attribution row. */
  lockedRevShareBps?: number | null;
  /** Locked customer discount from attribution row. */
  lockedCustomerDiscountBps?: number | null;
  /** Locked promoter commission from attribution row. */
  lockedPromoterCommissionBps?: number | null;
}

export function computeLockedPromoterEarning(
  input: PromoterEarningInput,
): number | null {
  const quantity =
    Number.isInteger(input.quantity) && input.quantity! > 0
      ? (input.quantity as number)
      : 1;

  // 1. Already locked — never recompute.
  if (Number.isInteger(input.promoterCommissionAmountCents)) {
    return input.promoterCommissionAmountCents as number;
  }

  // 2. Phase 2 snapshot basis.
  if (
    Number.isInteger(input.promoterOriginalAmountCents) &&
    input.promoterOriginalAmountCents! > 0 &&
    (input.promoterCustomerDiscountBps != null ||
      input.lockedCustomerDiscountBps != null) &&
    (input.promoterCommissionBps != null ||
      input.lockedPromoterCommissionBps != null)
  ) {
    try {
      const commission = computePromoterCommission({
        lines: [{
          eligibleAmountCents: input.promoterOriginalAmountCents as number,
          quantity,
        }],
        customerDiscountBps:
          (input.promoterCustomerDiscountBps as number) ??
            input.lockedCustomerDiscountBps,
        promoterCommissionBps:
          (input.promoterCommissionBps as number) ??
            input.lockedPromoterCommissionBps,
      });
      return commission.commissionAmountCents;
    } catch {
      return null;
    }
  }

  // 3. Legacy organizer-net basis.
  let organizerNet: number | null = null;
  if (
    Number.isInteger(input.subtotalCents) &&
    Number.isInteger(input.organizerFeeCents)
  ) {
    organizerNet = input.subtotalCents! - input.organizerFeeCents!;
  } else if (
    Number.isInteger(input.subtotalCents) &&
    input.subtotalCents! > 0
  ) {
    try {
      organizerNet = computeFees(
        input.subtotalCents as number,
        quantity,
      ).organizer_transfer_amount;
    } catch {
      organizerNet = null;
    }
  }
  if (organizerNet == null || organizerNet <= 0) return null;
  const lockedRevShareBps =
    Number.isInteger(input.lockedRevShareBps) && input.lockedRevShareBps! > 0
      ? (input.lockedRevShareBps as number)
      : null;
  if (lockedRevShareBps == null) return null;
  return Math.floor((organizerNet * lockedRevShareBps) / 10000);
}
