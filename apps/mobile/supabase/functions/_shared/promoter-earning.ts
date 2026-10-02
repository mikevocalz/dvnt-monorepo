/**
 * Promoter earning computation for an already-attributed paid order.
 *
 * Pure logic used by recordPromoterEarning. Returns locked earning in cents
 * or null when none can be computed.
 */

import { computeFees } from "./fee-calculator.ts";
import { computePromoterCommission } from "./promoter-commission.ts";

export interface PromoterEarningInput {
  promoterCommissionAmountCents?: number | null;
  promoterOriginalAmountCents?: number | null;
  promoterCustomerDiscountBps?: number | null;
  promoterCommissionBps?: number | null;
  subtotalCents?: number | null;
  organizerFeeCents?: number | null;
  quantity?: number | null;
  lockedRevShareBps?: number | null;
  lockedCustomerDiscountBps?: number | null;
  lockedPromoterCommissionBps?: number | null;
}

export function computeLockedPromoterEarning(
  input: PromoterEarningInput,
): number | null {
  if (Number.isInteger(input.promoterCommissionAmountCents)) {
    return input.promoterCommissionAmountCents as number;
  }

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
          quantity: 1, // snapshot is the whole order's eligible subtotal
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
        Number.isInteger(input.quantity) && input.quantity! > 0
          ? input.quantity!
          : 1,
      ).organizer_transfer_amount;
    } catch {
      organizerNet = null;
    }
  }
  if (organizerNet == null || organizerNet <= 0) return null;
  if (!Number.isInteger(input.lockedRevShareBps) || input.lockedRevShareBps! <= 0) {
    return null;
  }
  return Math.floor((organizerNet * input.lockedRevShareBps!) / 10000);
}
