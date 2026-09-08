/**
 * Four independent kill switches, per §11.
 *
 * Independent because the failures are independent. A Google outage on web
 * should not stop native; a fairness bug in the selector should stop DELIVERY
 * without also refusing organizers who are mid-checkout; and a payment incident
 * should stop SALES while campaigns already paid for keep running.
 *
 * Every switch fails closed: an absent or unparsable config serves nothing.
 * A config fetch that has not landed yet is not permission to serve.
 */

export interface AdKillSwitches {
  /** AdMob native placements in the mobile feed. */
  ads_google_native: boolean;
  /** AdSense placements on web, in-feed and rail. */
  ads_google_web: boolean;
  /** Organizers may buy a new boost. */
  boost_sales: boolean;
  /** Existing boosts may be served. */
  boost_delivery: boolean;
}

/** Nothing serves and nothing sells. The state before config arrives. */
export const ALL_OFF: AdKillSwitches = {
  ads_google_native: false,
  ads_google_web: false,
  boost_sales: false,
  boost_delivery: false,
};

/**
 * Parse remote config into switches.
 *
 * Only an explicit `true` enables anything. A missing key, a string "true", a
 * 1, or a malformed payload all resolve to off — the cost of a wrongly-off
 * switch is lost revenue for minutes, and the cost of a wrongly-on one is
 * serving ads during the incident the switch exists to stop.
 */
export function parseKillSwitches(raw: unknown): AdKillSwitches {
  if (!raw || typeof raw !== "object") return ALL_OFF;
  const source = raw as Record<string, unknown>;
  const read = (key: keyof AdKillSwitches): boolean => source[key] === true;
  return {
    ads_google_native: read("ads_google_native"),
    ads_google_web: read("ads_google_web"),
    boost_sales: read("boost_sales"),
    boost_delivery: read("boost_delivery"),
  };
}

export type AdSurface = "native" | "web";

/** The Google switch for one platform. */
export function googleAdsEnabled(
  switches: AdKillSwitches,
  surface: AdSurface,
): boolean {
  return surface === "native"
    ? switches.ads_google_native
    : switches.ads_google_web;
}

/**
 * Selling and serving are separate questions.
 *
 * Turning off delivery does NOT refund anyone by itself — it stops impressions
 * while the incident is handled, and the remedy is a decision made afterwards.
 * Turning off sales leaves paid campaigns running.
 */
export function boostSalesOpen(switches: AdKillSwitches): boolean {
  return switches.boost_sales;
}
export function boostDeliveryOpen(switches: AdKillSwitches): boolean {
  return switches.boost_delivery;
}
