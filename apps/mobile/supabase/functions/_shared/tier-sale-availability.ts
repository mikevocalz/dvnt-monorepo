/**
 * Sale policy for ordinary online tier purchases (native PaymentSheet and
 * hosted Checkout), before either paid checkout or zero-dollar issuance.
 *
 * This does not replace tier visibility, the event-wide sales cutoff, or the
 * atomic inventory allocator. It deliberately does not apply to staff comps,
 * RSVP RPCs, or door/Terminal flows, which have separate admission policies.
 */
export interface TierSaleAvailabilityRow {
  is_active?: boolean | null;
  is_sold_out?: boolean | null;
  status?: string | null;
  sale_start?: string | null;
  sale_end?: string | null;
}

export type TierSaleAvailabilityError = {
  code:
    | "tier_unavailable"
    | "sold_out"
    | "sale_not_started"
    | "sale_ended"
    | "invalid_sale_window";
  error: string;
};

export function tierSaleAvailabilityError(
  tier: TierSaleAvailabilityRow,
  nowMs: number = Date.now(),
): TierSaleAvailabilityError | null {
  if (tier.is_sold_out === true || tier.status === "sold_out") {
    return { code: "sold_out", error: "This ticket tier is sold out." };
  }
  // The cart rail and client pricing policy already require on_sale.
  // Missing legacy flags remain compatible, but draft/scheduled/unknown
  // explicit states must never silently become purchasable.
  if (
    tier.is_active === false ||
    (tier.status != null && tier.status !== "on_sale")
  ) {
    return {
      code: "tier_unavailable",
      error: "This ticket tier is not available for purchase.",
    };
  }

  const startsAt = tier.sale_start == null ? null : Date.parse(tier.sale_start);
  const endsAt = tier.sale_end == null ? null : Date.parse(tier.sale_end);
  if (
    !Number.isFinite(nowMs) ||
    (startsAt !== null && !Number.isFinite(startsAt)) ||
    (endsAt !== null && !Number.isFinite(endsAt)) ||
    (startsAt !== null && endsAt !== null && startsAt >= endsAt)
  ) {
    return {
      code: "invalid_sale_window",
      error: "This ticket tier is not available for purchase.",
    };
  }
  // Opening is inclusive, closing is exclusive, matching hosted checkout.
  if (startsAt !== null && nowMs < startsAt) {
    return { code: "sale_not_started", error: "Sales for this tier have not started yet." };
  }
  if (endsAt !== null && nowMs >= endsAt) {
    return { code: "sale_ended", error: "Sales for this tier have ended." };
  }
  return null;
}
