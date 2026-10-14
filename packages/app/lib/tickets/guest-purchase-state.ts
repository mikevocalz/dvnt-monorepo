import {
  filterBuyerVisibleTiers,
  pickDefaultBuyerTier,
  tierIsPurchasable,
  tierDisplayPriceCents,
  type TierInventory,
} from "./pricing.ts";

export interface GuestPurchaseTier extends TierInventory {
  id: string;
  name: string;
  is_active: boolean;
  status?: string | null;
  sale_start?: string | null;
  sale_end?: string | null;
  tier_visibility?: string | null;
}

export type GuestPurchaseState<T> =
  | { kind: "loading" | "error" | "unavailable" | "rsvp" }
  | { kind: "checkout"; tier: T };

/**
 * Guest purchasing must wait for the authoritative event and ticket query.
 * Display-only event tiers never supply checkout IDs or turn a missing read
 * into a free RSVP. The server still validates inventory and reprices orders.
 */
export function resolveGuestPurchase<T extends GuestPurchaseTier>({
  event,
  eventPending,
  eventError,
  tiers,
  tiersPending,
  tiersError,
  unlockedTierIds,
  selectedTierId,
}: {
  event: {
    price?: number;
    ticketingEnabled?: boolean;
    ticketTiers?: readonly unknown[];
  } | null | undefined;
  eventPending: boolean;
  eventError: boolean;
  tiers: readonly T[] | undefined;
  tiersPending: boolean;
  tiersError: boolean;
  unlockedTierIds?: ReadonlySet<string>;
  selectedTierId?: string;
}): GuestPurchaseState<T> {
  if (eventPending || tiersPending) return { kind: "loading" };
  if (eventError || tiersError) return { kind: "error" };
  if (!event || !tiers) return { kind: "unavailable" };

  const available = filterBuyerVisibleTiers(
    tiers.filter((tier) =>
      tier.is_active &&
      tierIsPurchasable({ ...tier, status: tier.status ?? undefined }),
    ),
    unlockedTierIds,
  ).visible;
  const tier = selectedTierId !== undefined
    ? available.find((candidate) => candidate.id === selectedTierId)
    : pickDefaultBuyerTier(
        available,
        Number(event.price || 0) > 0,
        (candidate) => tierDisplayPriceCents(candidate),
      );
  if (tier) return { kind: "checkout", tier };

  // Only a completed read of a genuinely tier-less free event can RSVP.
  // Hidden, locked, inactive, sold-out or not-yet-loaded tiers aren't tier-less.
  if (
    selectedTierId === undefined &&
    event.ticketingEnabled === false &&
    !event.price &&
    tiers.length === 0 &&
    (event.ticketTiers?.length ?? 0) === 0
  ) {
    return { kind: "rsvp" };
  }
  return { kind: "unavailable" };
}
