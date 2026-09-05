/**
 * useEntitlements — the app's read path for "what can this user do?".
 *
 * Queries the user's membership_subscriptions (new DVNT membership/Sneaky tiers)
 * and legacy sneaky_subscriptions rows, maps both to SubscriptionRecord[], and
 * runs the resolver (membership supersedes Sneaky-only). Returns the resolved
 * Entitlements plus loading/refetch. Never trusts client pricing — entitlements
 * derive from DB subscription state set by the Stripe / RevenueCat webhooks.
 *
 * I3: this is the ONE entitlement read path on the client — both rails
 * (web Stripe, mobile IAP via RevenueCat) resolve here from Supabase, never
 * from a processor SDK. Records carry `rail` so cross-rail UI (WS-3) can show
 * "subscribed via web / App Store / Google Play" without touching a processor.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { resolveEntitlementsForUser, FREE_ENTITLEMENTS } from "./entitlements";
import type { Entitlements, PlanKey, SubscriptionRecord } from "./types";

/** Which processor rail wrote a membership_subscriptions row (DB CHECK). */
export type MembershipRail = "web_stripe" | "ios_iap" | "play_iap";

/** SubscriptionRecord + the rail column (membership_subscriptions only; legacy
 *  sneaky rows are Stripe-era and normalized to `web_stripe`). */
export interface RailedSubscriptionRecord extends SubscriptionRecord {
  rail: MembershipRail | null;
}

/** Base key for the entitlements query — invalidate with
 *  `queryClient.invalidateQueries({ queryKey: ENTITLEMENTS_QUERY_KEY })`
 *  (prefix-matches every user's cache entry). */
export const ENTITLEMENTS_QUERY_KEY = ["entitlements"] as const;

// Legacy sneaky_subscriptions.plan_id → model PlanKey (best-effort migration map).
const LEGACY_SNEAKY_PLAN: Record<string, PlanKey> = {
  free: "free",
  host_25: "sneaky_tier_1",
  host_50: "sneaky_tier_2",
};

async function fetchSubscriptionRecords(
  userId: string,
): Promise<RailedSubscriptionRecord[]> {
  const [membership, sneaky] = await Promise.all([
    supabase
      .from("membership_subscriptions")
      .select(
        "product_family, plan_key, status, rail, current_period_end, cancel_at_period_end, grace_period_ends_at, stripe_subscription_id, stripe_customer_id",
      )
      .eq("user_id", userId),
    supabase
      .from("sneaky_subscriptions")
      .select(
        "plan_id, status, current_period_end, cancel_at_period_end, stripe_subscription_id, stripe_customer_id",
      )
      .eq("host_id", userId),
  ]);

  const records: RailedSubscriptionRecord[] = [];

  for (const r of membership.data ?? []) {
    records.push({
      productFamily: (r as any).product_family,
      planKey: (r as any).plan_key,
      status: (r as any).status,
      rail: (r as any).rail ?? null,
      currentPeriodEnd: (r as any).current_period_end,
      cancelAtPeriodEnd: (r as any).cancel_at_period_end,
      gracePeriodEndsAt: (r as any).grace_period_ends_at,
      stripeSubscriptionId: (r as any).stripe_subscription_id,
      stripeCustomerId: (r as any).stripe_customer_id,
    });
  }
  for (const r of sneaky.data ?? []) {
    records.push({
      productFamily: "sneaky_lynk",
      planKey: LEGACY_SNEAKY_PLAN[(r as any).plan_id] ?? "free",
      status: (r as any).status,
      rail: "web_stripe",
      currentPeriodEnd: (r as any).current_period_end,
      cancelAtPeriodEnd: (r as any).cancel_at_period_end,
      stripeSubscriptionId: (r as any).stripe_subscription_id,
      stripeCustomerId: (r as any).stripe_customer_id,
    });
  }
  return records;
}

export interface UseEntitlementsResult {
  entitlements: Entitlements;
  records: RailedSubscriptionRecord[];
  isLoading: boolean;
  refetch: () => void;
}

export function useEntitlements(): UseEntitlementsResult {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const query = useQuery({
    queryKey: [...ENTITLEMENTS_QUERY_KEY, userId],
    enabled: !!userId,
    staleTime: 60_000,
    queryFn: () => fetchSubscriptionRecords(userId as string),
  });

  const records = query.data ?? [];
  const entitlements = userId
    ? resolveEntitlementsForUser(records, new Date())
    : FREE_ENTITLEMENTS;

  return {
    entitlements,
    records,
    isLoading: query.isLoading,
    refetch: () => void query.refetch(),
  };
}
