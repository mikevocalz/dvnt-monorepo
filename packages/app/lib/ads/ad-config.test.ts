import test from "node:test";
import assert from "node:assert/strict";
import {
  ALL_OFF,
  boostDeliveryOpen,
  boostSalesOpen,
  googleAdsEnabled,
  parseKillSwitches,
} from "./ad-config.ts";
import {
  dedupeByPlacementToken,
  impressionRejection,
  isQualifiedImpression,
  longestQualifyingRunMs,
  type VisibilitySample,
} from "./qualified-impression.ts";

test("an absent or malformed config serves nothing", () => {
  for (const bad of [null, undefined, "", 0, [], "true"]) {
    assert.deepEqual(parseKillSwitches(bad), ALL_OFF, JSON.stringify(bad));
  }
});

test("only an explicit true enables a switch", () => {
  const parsed = parseKillSwitches({
    ads_google_native: true,
    ads_google_web: "true",
    boost_sales: 1,
    boost_delivery: undefined,
  });
  assert.equal(parsed.ads_google_native, true);
  assert.equal(parsed.ads_google_web, false, "a string is not true");
  assert.equal(parsed.boost_sales, false, "a 1 is not true");
  assert.equal(parsed.boost_delivery, false);
});

test("the four switches are independent", () => {
  const s = parseKillSwitches({ ads_google_native: true, boost_delivery: true });
  assert.equal(googleAdsEnabled(s, "native"), true);
  assert.equal(googleAdsEnabled(s, "web"), false, "web is not implied by native");
  assert.equal(boostSalesOpen(s), false, "sales is not implied by delivery");
  assert.equal(boostDeliveryOpen(s), true);
});

const sample = (at: number, fraction: number, foregrounded = true): VisibilitySample => ({
  at,
  fraction,
  foregrounded,
});

test("half visible for a continuous second qualifies", () => {
  assert.equal(
    isQualifiedImpression([sample(0, 0.6), sample(1000, 0.6), sample(1200, 0)]),
    true,
  );
});

test("fragments do not add up to a continuous second", () => {
  // Three 400ms glimpses — 1200ms of visible time, never continuous.
  const scrolled = [
    sample(0, 0.6), sample(400, 0.1),
    sample(800, 0.6), sample(1200, 0.1),
    sample(1600, 0.6), sample(2000, 0.1),
    sample(2400, 0),
  ];
  assert.equal(longestQualifyingRunMs(scrolled), 400);
  assert.equal(isQualifiedImpression(scrolled), false);
});

test("just under half visible never qualifies, however long", () => {
  assert.equal(
    isQualifiedImpression([sample(0, 0.49), sample(10_000, 0.49), sample(20_000, 0)]),
    false,
  );
});

test("time while backgrounded does not count", () => {
  assert.equal(
    isQualifiedImpression([
      sample(0, 1, false),
      sample(5000, 1, false),
      sample(5500, 1),
      sample(5900, 0),
    ]),
    false,
    "only 400ms was actually in front",
  );
});

test("one placement token is one impression, however many times it scrolls past", () => {
  assert.deepEqual(
    dedupeByPlacementToken([
      { placementToken: "t1" },
      { placementToken: "t1" },
      { placementToken: "t2" },
      { placementToken: "t1" },
    ]),
    ["t1", "t2"],
  );
});

test("an organizer cannot inflate their own delivery by looking at it", () => {
  const good = [sample(0, 1), sample(2000, 1), sample(2100, 0)];
  const ctx = { isSelfView: false, isPreview: false, isBot: false, alreadyCounted: false };
  assert.equal(impressionRejection(good, ctx), null);
  assert.equal(impressionRejection(good, { ...ctx, isSelfView: true }), "self-view");
  assert.equal(impressionRejection(good, { ...ctx, isPreview: true }), "preview");
  assert.equal(impressionRejection(good, { ...ctx, isBot: true }), "bot");
  assert.equal(impressionRejection(good, { ...ctx, alreadyCounted: true }), "replay");
  assert.equal(
    impressionRejection([sample(0, 0.6), sample(200, 0)], ctx),
    "not-visible-long-enough",
  );
});
