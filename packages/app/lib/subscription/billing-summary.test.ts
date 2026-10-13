import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { URL } from "node:url";
import { billingSummary } from "./billing-summary.ts";
import { resolveEntitlementsForUser } from "./entitlements.ts";
import type { RailedSubscriptionRecord } from "./subscription-records.ts";

const now = new Date("2026-10-13T00:00:00Z");
const future = "2026-10-14T00:00:00Z";
function summary(overrides: Partial<RailedSubscriptionRecord> = {}) {
  const row: RailedSubscriptionRecord = { productFamily: "sneaky_lynk", planKey: "sneaky_tier_1", status: "active", rail: "ios_iap", currentPeriodEnd: future, ...overrides };
  return billingSummary([row], resolveEntitlementsForUser([row], now), now);
}

test("IAP users are paid without Stripe IDs and cannot stack a web subscription", () => {
  for (const rail of ["ios_iap", "play_iap"] as const) {
    const info = summary({ rail });
    assert.equal(info.isFree, false);
    assert.equal(info.isActive, true);
    assert.equal(info.canManageStripe, false);
    assert.equal(info.canCheckoutStandalone, false);
    assert.equal(info.subscription.plan_id, "host_25");
    assert.match(info.planInfo.price, /Billed through/);
  }
});

test("DVNT membership is displayed instead of Free and routes plan changes away from legacy checkout", () => {
  const info = summary({ productFamily: "dvnt_membership", planKey: "dvnt_vip", rail: "web_stripe", stripeSubscriptionId: "fixture-subscription" });
  assert.equal(info.subscription.plan_id, "dvnt_vip");
  assert.equal(info.planInfo.maxPax, 50);
  assert.equal(info.canManageStripe, true);
  assert.equal(info.canCheckoutStandalone, false);
});

test("legacy Stripe-only members keep their existing plan-management path", () => {
  const info = summary({ rail: "web_stripe", stripeSubscriptionId: "fixture-subscription" });
  assert.equal(info.planInfo.price, "$9.99/mo");
  assert.equal(info.canManageStripe, true);
  assert.equal(info.canCheckoutStandalone, true);
});

test("expired paid rows show current free limits and never appear ACTIVE", () => {
  const info = summary({ currentPeriodEnd: "2026-10-12T00:00:00Z" });
  assert.equal(info.isActive, false);
  assert.equal(info.subscription.status, "inactive");
  assert.equal(info.planInfo.maxPax, 5);
});

test("billing surfaces use the unified read and expose verification failures", () => {
  for (const relative of [
    "../../features/sneaky-lynk/screens/billing.web.tsx",
    "../../features/routes/screens/(protected)/sneaky-lynk/billing.tsx",
  ]) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /useEntitlements\(\)/);
    assert.doesNotMatch(source, /\.from\("sneaky_subscriptions"\)/);
    assert.match(source, /Could not verify your subscription/);
    assert.match(source, /canManageStripe/);
  }
  const modal = readFileSync(new URL("../../features/sneaky-lynk/components/SneakySubscriptionModal.tsx", import.meta.url), "utf8");
  assert.match(modal, /!isLoading && !isError && !webRailActive/);
  assert.match(modal, /if \(!billing \|\| !pkg \|\| !canSell\) return/);
  assert.doesNotMatch(modal, /\.eq\("host_id", authUser.id\)/);
});
