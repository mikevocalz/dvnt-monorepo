import { membershipOwnerKeys, type SubscriptionReadClient } from "./subscription-owner.ts";

/** Server-only room limits. Mirrors the client resolver, with parity fixtures. */
export interface LynkSubscriptionRow {
  product_family?: string;
  plan_key?: string;
  plan_id?: string;
  status: string;
  current_period_end?: string | null;
  cancel_at_period_end?: boolean | null;
  grace_period_ends_at?: string | null;
}

// Deno's deploy bundle cannot import packages/app. The fixture tests compare
// every plan/status/boundary here against the app's canonical resolver.
export const LYNK_PLAN_LIMITS: Record<string, {
  family: string; maxParticipants: number; sessionMinutes: number | null; rank: number;
}> = {
  free: { family: "dvnt_membership", maxParticipants: 5, sessionMinutes: 5, rank: 0 },
  sneaky_tier_1: { family: "sneaky_lynk", maxParticipants: 10, sessionMinutes: null, rank: 1 },
  sneaky_tier_2: { family: "sneaky_lynk", maxParticipants: 50, sessionMinutes: null, rank: 2 },
  dvnt_core: { family: "dvnt_membership", maxParticipants: 10, sessionMinutes: null, rank: 3 },
  dvnt_insider: { family: "dvnt_membership", maxParticipants: 20, sessionMinutes: null, rank: 4 },
  dvnt_vip: { family: "dvnt_membership", maxParticipants: 50, sessionMinutes: null, rank: 5 },
  dvnt_founders_circle: { family: "dvnt_membership", maxParticipants: 50, sessionMinutes: null, rank: 6 },
};
const LEGACY_PLANS: Record<string, string> = { free: "free", host_25: "sneaky_tier_1", host_50: "sneaky_tier_2" };

function active(row: LynkSubscriptionRow, now: number): boolean {
  const future = (date: string | null | undefined) => !!date && new Date(date).getTime() > now;
  if (row.status === "active" || row.status === "trialing") {
    return row.current_period_end == null || future(row.current_period_end);
  }
  if (row.status === "past_due") return future(row.grace_period_ends_at);
  return row.status === "canceled" && row.cancel_at_period_end === true && future(row.current_period_end);
}

export function resolveLynkSubscription(
  membership: LynkSubscriptionRow[],
  legacy: LynkSubscriptionRow[],
  now: number = Date.now(),
) {
  const candidates = [
    ...membership,
    ...legacy.map((r) => ({ ...r, plan_key: LEGACY_PLANS[r.plan_id ?? ""] ?? "free", product_family: "sneaky_lynk" })),
  ].filter((r) => r.plan_key !== "free" && r.plan_key &&
    Object.hasOwn(LYNK_PLAN_LIMITS, r.plan_key) &&
    LYNK_PLAN_LIMITS[r.plan_key].family === r.product_family && active(r, now));
  candidates.sort((a, b) => LYNK_PLAN_LIMITS[b.plan_key!].rank - LYNK_PLAN_LIMITS[a.plan_key!].rank);
  const planKey = candidates[0]?.plan_key ?? "free";
  return { planKey, ...LYNK_PLAN_LIMITS[planKey] };
}

export async function readLynkSubscription(source: unknown, userId: string, now: number = Date.now()) {
  const client = source as SubscriptionReadClient;
  const ownerKeys = await membershipOwnerKeys(client, userId);
  const [membership, legacy, grants] = await Promise.all([
    client.from("membership_subscriptions")
      .select("product_family, plan_key, status, current_period_end, cancel_at_period_end, grace_period_ends_at")
      .in("user_id", ownerKeys),
    client.from("sneaky_subscriptions")
      .select("plan_id, status, current_period_end, cancel_at_period_end, grace_period_ends_at")
      .eq("host_id", userId),
    client.from("membership_grant_records")
      .select("product_family, plan_key, status, current_period_end, cancel_at_period_end, grace_period_ends_at")
      .eq("user_id", userId),
  ]);
  if (membership.error || legacy.error || grants.error) {
    throw new Error("Could not verify subscription. Please try again.");
  }
  return resolveLynkSubscription(
    [...(membership.data ?? []), ...(grants.data ?? [])] as LynkSubscriptionRow[],
    (legacy.data ?? []) as LynkSubscriptionRow[], now,
  );
}
