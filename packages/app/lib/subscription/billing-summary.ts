/** Billing presentation comes from the same cross-rail entitlement snapshot. */
import { PLANS } from "./plans.ts";
import { isSubscriptionActive, selectEffectiveSubscription } from "./entitlements.ts";
import type { Entitlements, PlanKey } from "./types.ts";
import type { RailedSubscriptionRecord } from "./subscription-records.ts";

const LEGACY_IDS: Partial<Record<PlanKey, string>> = { sneaky_tier_1: "host_25", sneaky_tier_2: "host_50" };
export function billingSummary(records: RailedSubscriptionRecord[], entitlements: Entitlements, now: Date = new Date()) {
  const record = (selectEffectiveSubscription(records, now) ??
    records.find((r) => r.planKey !== "free" && Object.hasOwn(PLANS, r.planKey))) as RailedSubscriptionRecord | undefined;
  const complimentary = record?.source === "complimentary";
  const paidRecords = records.filter((r) => r.source !== "complimentary");
  const billingRecord = complimentary
    ? (selectEffectiveSubscription(paidRecords, now) ?? paidRecords.find((r) => !!r.stripeSubscriptionId)) as RailedSubscriptionRecord | undefined
    : record;
  const planKey = record?.planKey ?? "free";
  const plan = PLANS[planKey];
  const active = !!record && isSubscriptionActive(record, now);
  const store = billingRecord?.rail === "ios_iap" ? "the App Store" : billingRecord?.rail === "play_iap" ? "Google Play" : null;
  const externalPlan = records.some((r) => r.planKey !== "free" && isSubscriptionActive(r, now) &&
    (r.productFamily === "dvnt_membership" || r.rail === "ios_iap" || r.rail === "play_iap"));
  return {
    subscription: {
      plan_id: LEGACY_IDS[planKey] ?? planKey,
      status: !active && (record?.status === "active" || record?.status === "trialing") ? "inactive" : record?.status ?? "inactive",
      current_period_end: record?.currentPeriodEnd ?? null,
      cancel_at_period_end: record?.cancelAtPeriodEnd ?? false,
      stripe_subscription_id: record?.stripeSubscriptionId ?? null,
      grace_period_ends_at: record?.gracePeriodEndsAt ?? null,
    },
    planInfo: {
      name: plan.name,
      price: complimentary ? "Complimentary" : store ? `Billed through ${store}` : `$${(plan.priceCents / 100).toFixed(plan.priceCents % 100 ? 2 : 0)}/mo`,
      maxPax: entitlements.maxParticipants,
    },
    isComplimentary: complimentary && active,
    isActive: active,
    isFree: planKey === "free",
    canManageStripe: !!billingRecord?.stripeSubscriptionId && !store,
    canCheckoutStandalone: !externalPlan,
    store,
  };
}
