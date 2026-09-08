import test from "node:test";
import assert from "node:assert/strict";
import {
  AD_FREE_BENEFIT,
  adRefusalReason,
  adViewerFrom,
  canRequestGoogleAd,
  isAdResponseStale,
  type AdEligibilityInput,
  type EntitlementResolution,
} from "./ad-eligibility.ts";
import { PLANS } from "../subscription/plans.ts";
import { resolveEntitlementsForUser } from "../subscription/entitlements.ts";
import type { PlanKey } from "../subscription/types.ts";

const SERVABLE: AdEligibilityInput = {
  featureOn: true,
  viewer: "free",
  privacyAllows: true,
  surfaceSuitable: "eligible",
  spicyMode: false,
  providerConfigured: true,
};

const PAID_PLANS: PlanKey[] = [
  "sneaky_tier_1",
  "sneaky_tier_2",
  "dvnt_core",
  "dvnt_insider",
  "dvnt_vip",
  "dvnt_founders_circle",
];

test("every paid plan carries adsGoogleFree; free does not", () => {
  for (const key of PAID_PLANS) {
    assert.equal(PLANS[key].entitlements.adsGoogleFree, true, key);
  }
  assert.equal(PLANS.free.entitlements.adsGoogleFree, false);
});

test("all six paid plans resolve to a viewer we never request for", () => {
  for (const key of PAID_PLANS) {
    const entitlements = resolveEntitlementsForUser([
      {
        productFamily: PLANS[key].family,
        planKey: key,
        status: "active",
      },
    ]);
    const viewer = adViewerFrom({ status: "ready", entitlements }, true);
    assert.equal(viewer, "paid", key);
    assert.equal(canRequestGoogleAd({ ...SERVABLE, viewer }), false, key);
    assert.equal(adRefusalReason({ ...SERVABLE, viewer }), "viewer-paid", key);
  }
});

test("an unresolved lookup is never treated as free", () => {
  for (const resolution of [
    { status: "loading" },
    { status: "error" },
  ] as EntitlementResolution[]) {
    const viewer = adViewerFrom(resolution, true);
    assert.equal(viewer, "unknown");
    assert.equal(canRequestGoogleAd({ ...SERVABLE, viewer }), false);
    assert.equal(adRefusalReason({ ...SERVABLE, viewer }), "viewer-unknown");
  }
});

test("a signed-out viewer resolves to guest, which is servable", () => {
  const entitlements = resolveEntitlementsForUser([]);
  assert.equal(adViewerFrom({ status: "ready", entitlements }, false), "guest");
  assert.equal(canRequestGoogleAd({ ...SERVABLE, viewer: "guest" }), true);
});

test("a lapsed subscription stops being paid", () => {
  const entitlements = resolveEntitlementsForUser([
    {
      productFamily: "dvnt_membership",
      planKey: "dvnt_vip",
      status: "canceled",
      cancelAtPeriodEnd: false,
    },
  ]);
  assert.equal(entitlements.adsGoogleFree, false, "lapsed VIP falls back to free");
  assert.equal(adViewerFrom({ status: "ready", entitlements }, true), "free");
});

test("cancelled-with-time-left keeps the benefit until the period ends", () => {
  const future = new Date(Date.now() + 86_400_000).toISOString();
  const entitlements = resolveEntitlementsForUser([
    {
      productFamily: "dvnt_membership",
      planKey: "dvnt_vip",
      status: "canceled",
      cancelAtPeriodEnd: true,
      currentPeriodEnd: future,
    },
  ]);
  assert.equal(entitlements.adsGoogleFree, true);
  assert.equal(adViewerFrom({ status: "ready", entitlements }, true), "paid");
});

test("the gate fails closed on every single condition", () => {
  assert.equal(canRequestGoogleAd(SERVABLE), true, "baseline is servable");

  const closures: [Partial<AdEligibilityInput>, string][] = [
    [{ featureOn: false }, "feature-off"],
    [{ viewer: "unknown" }, "viewer-unknown"],
    [{ viewer: "paid" }, "viewer-paid"],
    [{ privacyAllows: false }, "privacy"],
    [{ surfaceSuitable: "unknown" }, "surface"],
    [{ surfaceSuitable: "ineligible" }, "surface"],
    [{ spicyMode: true }, "spicy-mode"],
    [{ providerConfigured: false }, "provider-unconfigured"],
  ];
  for (const [patch, reason] of closures) {
    const input = { ...SERVABLE, ...patch };
    assert.equal(canRequestGoogleAd(input), false, JSON.stringify(patch));
    assert.equal(adRefusalReason(input), reason, JSON.stringify(patch));
  }
});

test("an unknown surface is not an eligible one", () => {
  // The absence of an NSFW flag is not an affirmative suitability signal.
  assert.equal(
    canRequestGoogleAd({ ...SERVABLE, surfaceSuitable: "unknown" }),
    false,
  );
});

test("a response that outlived its eligibility generation is dropped", () => {
  assert.equal(isAdResponseStale(3, 3), false);
  assert.equal(isAdResponseStale(3, 4), true, "upgraded mid-request");
});

test("the subscription benefit never promises an ad-free feed", () => {
  const text = `${AD_FREE_BENEFIT.title} ${AD_FREE_BENEFIT.detail}`.toLowerCase();
  assert.match(text, /no google ads/);
  assert.match(text, /promoted events may still appear/);
  assert.equal(/ad[- ]free/.test(text), false, "must not claim ad-free");
});
