/**
 * Entitlement resolver tests. Run with the repo's tsx (no new framework):
 *   node --import tsx --test packages/app/lib/subscription/entitlements.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveEntitlements,
  resolveEntitlementsForUser,
  selectEffectiveSubscription,
  isSubscriptionActive,
  canCreateRoom,
  roomDurationLimitSeconds,
  canAccessProducedEvent,
  appliesPartnerDiscount,
  FREE_ENTITLEMENTS,
} from "./entitlements";
import type { SubscriptionRecord } from "./types";

const NOW = new Date("2026-06-11T00:00:00Z");
const future = "2026-12-01T00:00:00Z";
const past = "2026-01-01T00:00:00Z";

function sub(p: Partial<SubscriptionRecord>): SubscriptionRecord {
  return {
    productFamily: "dvnt_membership",
    planKey: "free",
    status: "active",
    ...p,
  };
}

test("no subscription resolves to Free", () => {
  const e = resolveEntitlements(null, NOW);
  assert.equal(e.planKey, "free");
  assert.equal(e.maxParticipants, 5);
  assert.equal(e.sessionMinutes, 5);
  assert.equal(e.monthlyHostSessions, null);
  assert.equal(e.faceForAccess, false);
});

test("Sneaky Tier 1: 10 ppl, unlimited duration, host controls", () => {
  const e = resolveEntitlements(sub({ productFamily: "sneaky_lynk", planKey: "sneaky_tier_1" }), NOW);
  assert.equal(e.maxParticipants, 10);
  assert.equal(e.sessionMinutes, null);
  assert.equal(e.monthlyHostSessions, null);
  assert.ok(e.blockAccounts && e.faceForAccess && e.muteChat && e.monitorRooms);
});

test("Sneaky Tier 2: 50 ppl", () => {
  const e = resolveEntitlements(sub({ productFamily: "sneaky_lynk", planKey: "sneaky_tier_2" }), NOW);
  assert.equal(e.maxParticipants, 50);
  assert.equal(e.sessionMinutes, null);
});

test("DVNT Core includes Sneaky access + 1 event/quarter", () => {
  const e = resolveEntitlements(sub({ planKey: "dvnt_core" }), NOW);
  assert.ok(e.sneakyLynkAccess);
  assert.equal(e.maxParticipants, 10);
  assert.equal(e.monthlyHostSessions, 3);
  assert.ok(e.faceForAccess && e.blockAccounts && e.muteChat);
  assert.ok(e.memberBadge && e.priorityRsvp);
  assert.equal(e.eventAllowance, 1);
  assert.equal(e.eventAllowancePeriod, "quarter");
});

test("DVNT Insider: 20 ppl, 5 sessions/mo, early ticket access, 1 event/month", () => {
  const e = resolveEntitlements(sub({ planKey: "dvnt_insider" }), NOW);
  assert.equal(e.maxParticipants, 20);
  assert.equal(e.monthlyHostSessions, 5);
  assert.ok(e.eventNetworkingRooms && e.earlyTicketAccess);
  assert.equal(e.eventAllowance, 1);
  assert.equal(e.eventAllowancePeriod, "month");
});

test("DVNT VIP: unlimited sessions, any produced event, vip admission", () => {
  const e = resolveEntitlements(sub({ planKey: "dvnt_vip" }), NOW);
  assert.equal(e.maxParticipants, 50);
  assert.equal(e.monthlyHostSessions, null);
  assert.equal(e.eventAllowance, null);
  assert.ok(e.anyProducedEventAccess && e.vipAdmission && e.expeditedEntry && e.coatCheck);
  assert.ok(e.vipRooms && e.recurringPrivateGroups && e.postEventAfterparties);
});

test("DVNT Founders Circle: partner discounts, experimental, invite-only", () => {
  const e = resolveEntitlements(sub({ planKey: "dvnt_founders_circle" }), NOW);
  assert.ok(e.partnerEventDiscounts && e.experimentalFeatures && e.inviteOnlyRooms);
  assert.ok(e.quarterlyMerchDrops && e.featuredMemberStatus && e.limitedCapacityPriority);
});

test("membership supersedes standalone Sneaky when both active", () => {
  const subs: SubscriptionRecord[] = [
    sub({ productFamily: "sneaky_lynk", planKey: "sneaky_tier_2", stripeSubscriptionId: "s1" }),
    sub({ productFamily: "dvnt_membership", planKey: "dvnt_core", stripeSubscriptionId: "m1" }),
  ];
  const eff = selectEffectiveSubscription(subs, NOW);
  assert.equal(eff?.planKey, "dvnt_core");
  const e = resolveEntitlementsForUser(subs, NOW);
  assert.ok(e.memberBadge); // membership won
});

test("past_due outside grace → Free; inside grace → entitled", () => {
  const lapsed = sub({ planKey: "dvnt_vip", status: "past_due", gracePeriodEndsAt: past });
  assert.equal(resolveEntitlements(lapsed, NOW).planKey, "free");
  const grace = sub({ planKey: "dvnt_vip", status: "past_due", gracePeriodEndsAt: future });
  assert.equal(resolveEntitlements(grace, NOW).planKey, "dvnt_vip");
});

test("canceled honors remaining paid period", () => {
  const stillPaid = sub({ planKey: "dvnt_vip", status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: future });
  assert.ok(isSubscriptionActive(stillPaid, NOW));
  const ended = sub({ planKey: "dvnt_vip", status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: past });
  assert.equal(isSubscriptionActive(ended, NOW), false);
  assert.equal(resolveEntitlements(ended, NOW), FREE_ENTITLEMENTS);
});

test("canCreateRoom enforces participant + monthly host limits", () => {
  const free = FREE_ENTITLEMENTS;
  assert.equal(canCreateRoom(free, { participants: 5 }).allowed, true); // 5 ok
  assert.equal(canCreateRoom(free, { participants: 6 }).allowed, false); // over cap
  // free hosts unlimited short rooms (no monthly count cap), just 5min/5ppl:
  assert.equal(canCreateRoom(free, { participants: 5, sessionsThisMonth: 99 }).allowed, true);

  const core = resolveEntitlements(sub({ planKey: "dvnt_core" }), NOW);
  assert.equal(canCreateRoom(core, { participants: 10, sessionsThisMonth: 2 }).allowed, true);
  assert.equal(canCreateRoom(core, { participants: 10, sessionsThisMonth: 3 }).allowed, false); // used all 3
  assert.equal(canCreateRoom(core, { participants: 11, sessionsThisMonth: 0 }).allowed, false); // over ppl

  const vip = resolveEntitlements(sub({ planKey: "dvnt_vip" }), NOW);
  assert.equal(canCreateRoom(vip, { participants: 50, sessionsThisMonth: 99 }).allowed, true); // unlimited
});

test("roomDurationLimitSeconds: free 300s, paid unlimited", () => {
  assert.equal(roomDurationLimitSeconds(FREE_ENTITLEMENTS), 300);
  assert.equal(roomDurationLimitSeconds(resolveEntitlements(sub({ planKey: "dvnt_vip" }), NOW)), null);
});

test("produced-event access + partner-discount eligibility", () => {
  const free = FREE_ENTITLEMENTS;
  const core = resolveEntitlements(sub({ planKey: "dvnt_core" }), NOW);
  const vip = resolveEntitlements(sub({ planKey: "dvnt_vip" }), NOW);
  const founders = resolveEntitlements(sub({ planKey: "dvnt_founders_circle" }), NOW);

  assert.equal(canAccessProducedEvent(free, { isProduced: true }).allowed, false);
  assert.equal(canAccessProducedEvent(free, { isProduced: false }).allowed, true); // partner/standard open
  assert.equal(canAccessProducedEvent(core, { isProduced: true, claimedThisPeriod: 0 }).allowed, true);
  assert.equal(canAccessProducedEvent(core, { isProduced: true, claimedThisPeriod: 1 }).allowed, false); // used quarter allowance
  assert.equal(canAccessProducedEvent(vip, { isProduced: true, claimedThisPeriod: 99 }).allowed, true); // any

  // Partner discount: only flagged events + eligible plan (founders), not VIP, not unflagged.
  assert.equal(appliesPartnerDiscount(founders, { isProduced: false, partnerDiscountEligible: true }), true);
  assert.equal(appliesPartnerDiscount(vip, { isProduced: false, partnerDiscountEligible: true }), false);
  assert.equal(appliesPartnerDiscount(founders, { isProduced: false, partnerDiscountEligible: false }), false);
});
