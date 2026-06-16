/**
 * React Query hooks for event promotions / spotlight campaigns.
 */

import { useQuery } from "@tanstack/react-query";
import { promotionsApi } from "@/lib/api/promotions";
import { useEventsLocationStore } from "@/lib/stores/events-location-store";
import type { SpotlightItem } from "@/src/events/promotion-types";

export const promotionKeys = {
  all: ["promotions"] as const,
  spotlight: (cityId?: number | null) =>
    [...promotionKeys.all, "spotlight", cityId ?? "all"] as const,
  promotedIds: (cityId?: number | null) =>
    [...promotionKeys.all, "promotedIds", cityId ?? "all"] as const,
  eventCampaigns: (eventId: string) =>
    [...promotionKeys.all, "campaigns", eventId] as const,
};

/**
 * Fetch active spotlight carousel items for current city.
 * Returns up to 8 promoted events with flyer/cover images.
 */
export function useSpotlightFeed() {
  const cityId = useEventsLocationStore((s) => s.activeCity?.id ?? null);

  return useQuery<SpotlightItem[]>({
    queryKey: promotionKeys.spotlight(cityId),
    queryFn: () => promotionsApi.getSpotlightFeed(cityId),
    staleTime: 5 * 60 * 1000, // 5min — promotions don't change often
  });
}

/**
 * Fetch promoted event IDs for the feed (used for is_promoted chip).
 * Returns a Set<number> of event IDs with active feed campaigns.
 */
export function usePromotedEventIds() {
  const cityId = useEventsLocationStore((s) => s.activeCity?.id ?? null);

  return useQuery<Set<number>>({
    queryKey: promotionKeys.promotedIds(cityId),
    queryFn: () => promotionsApi.getPromotedEventIds(cityId),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Fetch campaigns for a specific event (organizer view).
 */
export function useEventCampaigns(eventId: string) {
  return useQuery({
    queryKey: promotionKeys.eventCampaigns(eventId),
    queryFn: () => promotionsApi.getEventCampaigns(eventId),
    enabled: !!eventId,
    staleTime: 2 * 60 * 1000,
  });
}
