/** Pure, fixture-testable Supabase read path shared by every client surface. */
import { resolveEntitlementsForUser, FREE_ENTITLEMENTS } from "./entitlements.ts";
import type { PlanKey, SubscriptionRecord } from "./types.ts";
import { membershipOwnerKeys, type SubscriptionReadClient } from "./subscription-owner.ts";

export type MembershipRail = "web_stripe" | "ios_iap" | "play_iap";
export interface RailedSubscriptionRecord extends SubscriptionRecord {
  rail: MembershipRail | null;
  source?: "subscription" | "complimentary";
}

const LEGACY_SNEAKY_PLAN: Record<string, PlanKey> = {
  free: "free", host_25: "sneaky_tier_1", host_50: "sneaky_tier_2",
};

/** Get the auth principal first; membershipOwnerKeys verifies any profile-id alias. */
export function subscriptionAuthId(user: { id: string; authId?: string } | null): string | null {
  if (!user) return null;
  return user.authId?.trim() || (!/^\d+$/.test(user.id) ? user.id : null);
}

export async function fetchSubscriptionRecords(
  source: unknown,
  userId: string,
): Promise<RailedSubscriptionRecord[]> {
  // Narrow the Supabase boundary once; structurally comparing its generated
  // schema generics against this fixture interface exceeds TS recursion limits.
  const client = source as SubscriptionReadClient;
  const ownerKeys = await membershipOwnerKeys(client, userId);
  const [membership, sneaky, grants] = await Promise.all([
    client.from("membership_subscriptions")
      .select("product_family, plan_key, status, rail, current_period_end, cancel_at_period_end, grace_period_ends_at, stripe_subscription_id, stripe_customer_id")
      .in("user_id", ownerKeys),
    client.from("sneaky_subscriptions")
      .select("plan_id, status, current_period_end, cancel_at_period_end, grace_period_ends_at, stripe_subscription_id, stripe_customer_id")
      .eq("host_id", userId),
    client.from("membership_grant_records")
      .select("product_family, plan_key, status, rail, source, current_period_end, cancel_at_period_end, grace_period_ends_at, stripe_subscription_id, stripe_customer_id")
      .eq("user_id", userId),
  ]);
  // A failed lookup is not evidence that a user has the free plan. Reject the
  // whole read rather than reconciling a partial snapshot or caching it as truth.
  if (membership.error || sneaky.error || grants.error) {
    throw new Error("Could not verify subscription. Please try again.");
  }
  const map = (row: unknown, legacy: boolean): RailedSubscriptionRecord => {
    const r = row as Record<string, any>;
    return {
      productFamily: legacy ? "sneaky_lynk" : r.product_family,
      planKey: legacy ? LEGACY_SNEAKY_PLAN[r.plan_id] ?? "free" : r.plan_key,
      status: r.status,
      source: r.source === "complimentary" ? "complimentary" : "subscription",
      rail: legacy ? "web_stripe" : r.rail ?? null,
      currentPeriodEnd: r.current_period_end,
      cancelAtPeriodEnd: r.cancel_at_period_end,
      gracePeriodEndsAt: r.grace_period_ends_at,
      stripeSubscriptionId: r.stripe_subscription_id,
      stripeCustomerId: r.stripe_customer_id,
    };
  };
  return [
    ...(membership.data ?? []).map((r) => map(r, false)),
    ...(sneaky.data ?? []).map((r) => map(r, true)),
    ...(grants.data ?? []).map((r) => map(r, false)),
  ];
}

export function entitlementReadSnapshot(
  records: RailedSubscriptionRecord[] | undefined,
  state: "ready" | "loading" | "error" | "signed_out",
  now: Date = new Date(),
) {
  const verified = state === "ready" ? records ?? [] : [];
  return {
    records: verified,
    entitlements: state === "ready" ? resolveEntitlementsForUser(verified, now) : FREE_ENTITLEMENTS,
  };
}

/** Recompute at an entitlement boundary even if no webhook/refetch changes data. */
export function nextEntitlementBoundary(records: SubscriptionRecord[], now: number): number | null {
  const boundaries = records.flatMap((record) => {
    const end = record.status === "past_due" ? record.gracePeriodEndsAt : record.currentPeriodEnd;
    const at = end ? new Date(end).getTime() : NaN;
    return Number.isFinite(at) && at > now ? [at] : [];
  });
  return boundaries.length ? Math.min(...boundaries) : null;
}
