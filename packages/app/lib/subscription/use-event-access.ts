/**
 * useEventAccess — membership gating for a single event.
 *
 * For DVNT-produced events, resolves whether the current user may claim it under
 * their tier allowance (Core 1/quarter, Insider 1/month, VIP+ any), counting how
 * many produced events they've already claimed this period. Partner/standard
 * events are always open; partner discounts apply only to flagged partner events
 * for eligible plans (Founders Circle).
 *
 * Usage in an event's RSVP/buy UI:
 *   const { access, partnerDiscount } = useEventAccess(event);
 *   if (!access.allowed) // show upsell → MembershipScreen / web /pricing
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useEntitlements } from "./use-entitlements";
import {
  appliesPartnerDiscount,
  canAccessProducedEvent,
  type AccessDecision,
} from "./entitlements";
import type { AllowancePeriod, Entitlements } from "./types";

export interface EventLike {
  id: number | string;
  is_dvnt_produced?: boolean | null;
  partner_discount_eligible?: boolean | null;
}

function periodStart(period: AllowancePeriod): Date {
  const now = new Date();
  if (period === "quarter") {
    return new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
  }
  if (period === "month") {
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return new Date(0);
}

export interface UseEventAccessResult {
  access: AccessDecision;
  partnerDiscount: boolean;
  entitlements: Entitlements;
  isLoading: boolean;
}

export function useEventAccess(event: EventLike | null): UseEventAccessResult {
  const { entitlements } = useEntitlements();
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const isProduced = !!event?.is_dvnt_produced;
  const period = entitlements.eventAllowancePeriod;
  // Only need a claim count for a finite, period-based allowance on a produced event.
  const needsCount =
    isProduced &&
    entitlements.eventAllowance !== null &&
    entitlements.eventAllowance > 0 &&
    !!userId &&
    period !== null;

  const countQuery = useQuery({
    queryKey: ["produced-claims", userId, period],
    enabled: needsCount,
    staleTime: 60_000,
    queryFn: async () => {
      const since = periodStart(period).toISOString();
      const { count } = await supabase
        .from("event_rsvps")
        .select("event_id, events!inner(is_dvnt_produced)", {
          count: "exact",
          head: true,
        })
        .eq("user_id", userId as string)
        .gte("created_at", since)
        .eq("events.is_dvnt_produced", true);
      return count ?? 0;
    },
  });

  const req = {
    isProduced,
    partnerDiscountEligible: !!event?.partner_discount_eligible,
    claimedThisPeriod: countQuery.data ?? 0,
  };

  return {
    access: canAccessProducedEvent(entitlements, req),
    partnerDiscount: appliesPartnerDiscount(entitlements, req),
    entitlements,
    isLoading: needsCount && countQuery.isLoading,
  };
}
