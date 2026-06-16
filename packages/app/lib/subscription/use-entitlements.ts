/**
 * useEntitlements — the app's read path for "what can this user do?".
 *
 * Queries the user's membership_subscriptions (new DVNT membership/Sneaky tiers)
 * and legacy sneaky_subscriptions rows, maps both to SubscriptionRecord[], and
 * runs the resolver (membership supersedes Sneaky-only). Returns the resolved
 * Entitlements plus loading/refetch. Never trusts client pricing — entitlements
 * derive from DB subscription state set by the Stripe webhook.
 *
 * iOS compliance: this is read-only. Selling happens on the web (/pricing);
 * the native app only reads entitlements.
 */
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { resolveEntitlementsForUser, FREE_ENTITLEMENTS } from "./entitlements";
import type { Entitlements, PlanKey, SubscriptionRecord } from "./types";

// Legacy sneaky_subscriptions.plan_id → model PlanKey (best-effort migration map).
const LEGACY_SNEAKY_PLAN: Record<string, PlanKey> = {
  free: "free",
  host_25: "sneaky_tier_1",
  host_50: "sneaky_tier_2",
};

async function fetchSubscriptionRecords(
  userId: string,
): Promise<SubscriptionRecord[]> {
  const [membership, sneaky] = await Promise.all([
    supabase
      .from("membership_subscriptions")
      .select(
        "product_family, plan_key, status, current_period_end, cancel_at_period_end, grace_period_ends_at, stripe_subscription_id, stripe_customer_id",
      )
      .eq("user_id", userId),
    supabase
      .from("sneaky_subscriptions")
      .select(
        "plan_id, status, current_period_end, cancel_at_period_end, stripe_subscription_id, stripe_customer_id",
      )
      .eq("host_id", userId),
  ]);

  const records: SubscriptionRecord[] = [];

  for (const r of membership.data ?? []) {
    records.push({
      productFamily: (r as any).product_family,
      planKey: (r as any).plan_key,
      status: (r as any).status,
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
  records: SubscriptionRecord[];
  isLoading: boolean;
  refetch: () => void;
}

export function useEntitlements(): UseEntitlementsResult {
  const userId = useAuthStore((s) => s.user?.id ?? null);

  const query = useQuery({
    queryKey: ["entitlements", userId],
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
