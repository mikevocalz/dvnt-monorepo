/**
 * Entitlement resolver — the single authority for "what can this user do?".
 *
 * Inputs: the user's persisted subscription record(s) + the current time.
 * Output: an Entitlements object. Access control (room limits, event gating)
 * and paywall UI both read this — never a Stripe price id, never raw status.
 *
 * Rules encoded here:
 *  - No subscription, or a terminal/lapsed one → Free entitlements.
 *  - active / trialing → that plan's entitlements.
 *  - past_due → keep entitlements only while inside the dunning grace window,
 *    otherwise fall back to Free (don't grant paid access to non-payers).
 *  - canceled but cancelAtPeriodEnd with a future period end → still entitled
 *    until the period actually ends.
 *  - DVNT Membership SUPERSEDES standalone Sneaky Lynk: if a user holds both,
 *    the membership wins (it already includes Sneaky Lynk).
 */
import { PLANS, PLAN_RANK } from "./plans";
import type {
  Entitlements,
  PlanKey,
  SubscriptionRecord,
} from "./types";

export const FREE_ENTITLEMENTS: Entitlements = {
  family: "dvnt_membership",
  planKey: "free",
  ...PLANS.free.entitlements,
};

function entitlementsForPlan(planKey: PlanKey): Entitlements {
  const plan = PLANS[planKey];
  return { family: plan.family, planKey, ...plan.entitlements };
}

/** Is this subscription currently granting its plan's paid access? */
export function isSubscriptionActive(
  sub: SubscriptionRecord,
  now: Date = new Date(),
): boolean {
  switch (sub.status) {
    case "active":
    case "trialing":
      return true;
    case "past_due": {
      // Grace window only.
      if (!sub.gracePeriodEndsAt) return false;
      return new Date(sub.gracePeriodEndsAt).getTime() > now.getTime();
    }
    case "canceled": {
      // Honor remaining paid time if it was set to cancel at period end.
      if (sub.cancelAtPeriodEnd && sub.currentPeriodEnd) {
        return new Date(sub.currentPeriodEnd).getTime() > now.getTime();
      }
      return false;
    }
    default:
      return false;
  }
}

/**
 * From all of a user's subscription rows, pick the one that should drive
 * entitlements: prefer an active DVNT Membership (it supersedes Sneaky-only),
 * else the highest-ranked active subscription, else none.
 */
export function selectEffectiveSubscription(
  subs: SubscriptionRecord[],
  now: Date = new Date(),
): SubscriptionRecord | null {
  const active = subs.filter((s) => isSubscriptionActive(s, now));
  if (active.length === 0) return null;
  const membership = active
    .filter((s) => s.productFamily === "dvnt_membership")
    .sort((a, b) => PLAN_RANK[b.planKey] - PLAN_RANK[a.planKey]);
  if (membership.length > 0) return membership[0];
  return active.sort((a, b) => PLAN_RANK[b.planKey] - PLAN_RANK[a.planKey])[0];
}

/** Resolve entitlements from one subscription record (or null → Free). */
export function resolveEntitlements(
  sub: SubscriptionRecord | null,
  now: Date = new Date(),
): Entitlements {
  if (!sub || !isSubscriptionActive(sub, now)) return FREE_ENTITLEMENTS;
  return entitlementsForPlan(sub.planKey);
}

/** Resolve from a user's full set of subscription rows. */
export function resolveEntitlementsForUser(
  subs: SubscriptionRecord[],
  now: Date = new Date(),
): Entitlements {
  return resolveEntitlements(selectEffectiveSubscription(subs, now), now);
}

// ── Access-control helpers (used by Sneaky Lynk + Events enforcement) ──

export interface RoomCreateRequest {
  participants: number;
  /** Host sessions the user has already started in the current billing month. */
  sessionsThisMonth?: number;
}

export interface AccessDecision {
  allowed: boolean;
  reason?: string;
  /** The entitlement that would unblock this — useful for paywall deep-links. */
  upsell?: string;
}

/** Can this user create a Sneaky Lynk room with the requested shape? */
export function canCreateRoom(
  ent: Entitlements,
  req: RoomCreateRequest,
): AccessDecision {
  if (req.participants > ent.maxParticipants) {
    return {
      allowed: false,
      reason: `This plan allows up to ${ent.maxParticipants} people per link.`,
      upsell: "sneaky_lynk_max_participants",
    };
  }
  if (
    ent.monthlyHostSessions !== null &&
    (req.sessionsThisMonth ?? 0) >= ent.monthlyHostSessions
  ) {
    return {
      allowed: false,
      reason:
        ent.monthlyHostSessions === 0
          ? "Hosting is available on a paid plan."
          : `You've used all ${ent.monthlyHostSessions} hosted sessions this month.`,
      upsell: "sneaky_lynk_monthly_host_limit",
    };
  }
  return { allowed: true };
}

/** Max seconds a room may run for this user (null = unlimited). */
export function roomDurationLimitSeconds(ent: Entitlements): number | null {
  return ent.sessionMinutes === null ? null : ent.sessionMinutes * 60;
}

export interface EventAccessRequest {
  /** True for DVNT-produced events (vs partner-listed events). */
  isProduced: boolean;
  /** True if event metadata marks it eligible for partner discounts. */
  partnerDiscountEligible?: boolean;
  /** Count of allowance-consuming events the user already claimed this period. */
  claimedThisPeriod?: number;
}

/** Does the user's membership grant access to a DVNT-produced event? */
export function canAccessProducedEvent(
  ent: Entitlements,
  req: EventAccessRequest,
): AccessDecision {
  if (!req.isProduced) return { allowed: true }; // partner/standard events: open
  if (ent.anyProducedEventAccess) return { allowed: true };
  if (ent.eventAllowance === null) return { allowed: true };
  if ((req.claimedThisPeriod ?? 0) < ent.eventAllowance) return { allowed: true };
  return {
    allowed: false,
    reason: ent.eventAllowance === 0
      ? "DVNT-produced events are a membership benefit."
      : `Your plan includes ${ent.eventAllowance} DVNT event per ${ent.eventAllowancePeriod}.`,
    upsell: "dvnt_event_allowance",
  };
}

/** Partner discounts apply only to flagged partner events for eligible plans. */
export function appliesPartnerDiscount(
  ent: Entitlements,
  req: EventAccessRequest,
): boolean {
  return !!req.partnerDiscountEligible && ent.partnerEventDiscounts;
}
