import test from "node:test";
import assert from "node:assert/strict";
import {
  boostUnavailableCopy,
  mayLinkToWebPurchase,
  resolveBoostPaymentRoute,
  type BoostPaymentContext,
} from "./boost-payment-route.ts";

const MOBILE: BoostPaymentContext = {
  platform: "ios",
  mobileSalesEnabled: true,
  salesOpen: true,
  iapAvailable: true,
};

test("Stripe is never the route on a mobile platform", () => {
  // Guideline 3.1.3(g): buying ads displayed in the same app must use IAP.
  // There must be no combination of flags that returns "stripe" on iOS or
  // Android — that is the whole reason this function exists.
  for (const platform of ["ios", "android"] as const) {
    for (const mobileSalesEnabled of [true, false]) {
      for (const salesOpen of [true, false]) {
        for (const iapAvailable of [true, false]) {
          const route = resolveBoostPaymentRoute({
            platform,
            mobileSalesEnabled,
            salesOpen,
            iapAvailable,
          });
          assert.notEqual(
            route,
            "stripe",
            `${platform} ${mobileSalesEnabled} ${salesOpen} ${iapAvailable}`,
          );
        }
      }
    }
  }
});

test("mobile sells through IAP when everything is in place", () => {
  assert.equal(resolveBoostPaymentRoute(MOBILE), "iap");
  assert.equal(
    resolveBoostPaymentRoute({ ...MOBILE, platform: "android" }),
    "iap",
  );
});

test("web sells through Stripe", () => {
  assert.equal(
    resolveBoostPaymentRoute({ ...MOBILE, platform: "web" }),
    "stripe",
  );
});

test("the sales kill switch closes every route, on every platform", () => {
  for (const platform of ["ios", "android", "web"] as const) {
    assert.equal(
      resolveBoostPaymentRoute({ ...MOBILE, platform, salesOpen: false }),
      "unavailable",
      platform,
    );
  }
});

test("the web-only posture leaves mobile with no purchase path", () => {
  assert.equal(
    resolveBoostPaymentRoute({ ...MOBILE, mobileSalesEnabled: false }),
    "unavailable",
  );
  // Web still sells — that is the point of the posture.
  assert.equal(
    resolveBoostPaymentRoute({
      ...MOBILE,
      platform: "web",
      mobileSalesEnabled: false,
    }),
    "stripe",
  );
});

test("a missing RevenueCat module is unavailable, not a Stripe fallback", () => {
  assert.equal(
    resolveBoostPaymentRoute({ ...MOBILE, iapAvailable: false }),
    "unavailable",
  );
});

test("steering to the web is US-storefront only, absent an entitlement", () => {
  assert.equal(
    mayLinkToWebPurchase({ platform: "ios", storefront: "US" }),
    true,
  );
  assert.equal(
    mayLinkToWebPurchase({ platform: "ios", storefront: "GB" }),
    false,
    "3.1.3 forbids steering outside the US storefront",
  );
  assert.equal(
    mayLinkToWebPurchase({ platform: "ios", storefront: null }),
    false,
    "an unknown storefront is not permission",
  );
  assert.equal(
    mayLinkToWebPurchase({
      platform: "ios",
      storefront: "GB",
      hasExternalPurchaseEntitlement: true,
    }),
    true,
  );
  assert.equal(mayLinkToWebPurchase({ platform: "web", storefront: null }), true);
});

test("copy never steers where steering is not permitted", () => {
  const steered = boostUnavailableCopy({
    salesOpen: true,
    iapAvailable: false,
    mayLinkToWeb: true,
  });
  assert.match(steered.detail, /website/i);

  const notSteered = boostUnavailableCopy({
    salesOpen: true,
    iapAvailable: false,
    mayLinkToWeb: false,
  });
  assert.equal(/website|dvnt\.app|online/i.test(notSteered.detail), false);
});

test("a paused sale says existing boosts keep running", () => {
  const copy = boostUnavailableCopy({
    salesOpen: false,
    iapAvailable: true,
    mayLinkToWeb: true,
  });
  assert.match(copy.detail, /existing boosts keep running/i);
});
