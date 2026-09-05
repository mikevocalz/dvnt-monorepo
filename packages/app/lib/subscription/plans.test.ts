/**
 * Plan-catalog contract tests (RC product ids + derived caps). Run with the
 * repo's tsx (no new framework):
 *   node --import tsx --test packages/app/lib/subscription/plans.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  PLANS,
  PLAN_CAPS,
  PLAN_FAMILY,
  RC_PRODUCT_TO_PLAN_KEY,
  planKeyFromRCProductId,
} from "./plans";
import type { PlanKey } from "./types";

const PAID_MEMBERSHIP_KEYS: PlanKey[] = [
  "dvnt_core",
  "dvnt_insider",
  "dvnt_vip",
  "dvnt_founders_circle",
];

const PAID_SNEAKY_KEYS: PlanKey[] = ["sneaky_tier_1", "sneaky_tier_2"];

const RC_SOLD_KEYS: PlanKey[] = [...PAID_MEMBERSHIP_KEYS, ...PAID_SNEAKY_KEYS];

test("RC_PRODUCT_TO_PLAN_KEY covers exactly the RC-sold plans (membership + sneaky)", () => {
  assert.deepEqual(
    Object.keys(RC_PRODUCT_TO_PLAN_KEY).sort(),
    [...RC_SOLD_KEYS].sort(),
  );
  // Contract: revenueCatProductId equals the plan key (iOS/Test Store
  // store_identifier and the Play subscriptionId are both exactly this).
  for (const key of RC_SOLD_KEYS) {
    assert.equal(PLANS[key].revenueCatProductId, key);
    assert.equal(RC_PRODUCT_TO_PLAN_KEY[key], key);
  }
  // Free is NOT sold through RC.
  assert.equal(PLANS.free.revenueCatProductId, undefined);
});

test("planKeyFromRCProductId: iOS / Test Store bare product ids", () => {
  for (const key of RC_SOLD_KEYS) {
    assert.equal(planKeyFromRCProductId(key), key);
  }
});

test("planKeyFromRCProductId: Play subscriptionId:basePlanId form", () => {
  assert.equal(planKeyFromRCProductId("dvnt_core:monthly"), "dvnt_core");
  assert.equal(planKeyFromRCProductId("dvnt_insider:monthly"), "dvnt_insider");
  assert.equal(planKeyFromRCProductId("dvnt_vip:monthly"), "dvnt_vip");
  assert.equal(
    planKeyFromRCProductId("dvnt_founders_circle:monthly"),
    "dvnt_founders_circle",
  );
  assert.equal(
    planKeyFromRCProductId("sneaky_tier_1:monthly"),
    "sneaky_tier_1",
  );
  assert.equal(
    planKeyFromRCProductId("sneaky_tier_2:monthly"),
    "sneaky_tier_2",
  );
  // Only the first `:` matters — Play base-plan ids can contain more.
  assert.equal(planKeyFromRCProductId("dvnt_vip:monthly:offer"), "dvnt_vip");
});

test("planKeyFromRCProductId: unknown products resolve to null (fail closed)", () => {
  assert.equal(planKeyFromRCProductId("rc_promo_pack"), null);
  assert.equal(planKeyFromRCProductId("host_25"), null); // legacy sneaky vocab
  assert.equal(planKeyFromRCProductId("free"), null); // free is not an RC product
  assert.equal(planKeyFromRCProductId("unknown:monthly"), null);
  assert.equal(planKeyFromRCProductId(""), null);
});

test("PLAN_FAMILY is derived from PLANS.family for every plan", () => {
  for (const plan of Object.values(PLANS)) {
    assert.equal(PLAN_FAMILY[plan.key], plan.family);
  }
  // Spot-check the split the webhook mirror relies on.
  assert.equal(PLAN_FAMILY.sneaky_tier_1, "sneaky_lynk");
  assert.equal(PLAN_FAMILY.sneaky_tier_2, "sneaky_lynk");
  assert.equal(PLAN_FAMILY.dvnt_core, "dvnt_membership");
  assert.equal(PLAN_FAMILY.free, "dvnt_membership");
});

test("PLAN_CAPS is derived from PLANS.entitlements for every plan", () => {
  for (const plan of Object.values(PLANS)) {
    assert.deepEqual(PLAN_CAPS[plan.key], {
      maxParticipants: plan.entitlements.maxParticipants,
      monthlyHostSessions: plan.entitlements.monthlyHostSessions,
      sessionMinutes: plan.entitlements.sessionMinutes,
    });
  }
  // Spot-check the values server mirrors hardcode today.
  assert.deepEqual(PLAN_CAPS.free, {
    maxParticipants: 5,
    monthlyHostSessions: null,
    sessionMinutes: 5,
  });
  assert.deepEqual(PLAN_CAPS.dvnt_core, {
    maxParticipants: 10,
    monthlyHostSessions: 3,
    sessionMinutes: null,
  });
  assert.deepEqual(PLAN_CAPS.dvnt_founders_circle, {
    maxParticipants: 50,
    monthlyHostSessions: null,
    sessionMinutes: null,
  });
});
