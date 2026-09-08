/**
 * The single gate every Google ad request passes through, on native and web.
 *
 * It fails CLOSED. Anything unknown — an entitlement lookup still in flight, a
 * failed lookup, a surface whose suitability has not been established — returns
 * false. The cost of a wrongly-suppressed ad is one missed impression; the cost
 * of a wrongly-served one is a paying member seeing advertising they bought
 * their way out of, or a Google request against content that breaches publisher
 * policy.
 *
 * This must be consulted BEFORE SDK initialization, script insertion, prefetch,
 * request, and view mount — not just before render. A suppressed pixel over a
 * request that already happened is not suppression.
 */

import type { Entitlements } from "@dvnt/app/lib/subscription/types";

/**
 * Whether we know what this viewer is entitled to.
 *
 * `resolveEntitlementsForUser([])` returns FREE_ENTITLEMENTS
 * (`lib/subscription/entitlements.ts:85`), so an empty subscription array is
 * indistinguishable from "we have not loaded any subscriptions yet". That
 * ambiguity is exactly what would serve ads to a paid member during the first
 * seconds of a cold start, so the loading and error cases are carried
 * explicitly here rather than collapsed into Free.
 */
export type EntitlementResolution =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; entitlements: Entitlements };

export type AdViewer = "unknown" | "guest" | "free" | "paid";

/**
 * Only an authoritative, successful lookup produces a viewer we may serve.
 * Guests are servable; "unknown" never is.
 */
export function adViewerFrom(
  resolution: EntitlementResolution,
  isAuthenticated: boolean,
): AdViewer {
  if (resolution.status !== "ready") return "unknown";
  if (!isAuthenticated) return "guest";
  return resolution.entitlements.adsGoogleFree ? "paid" : "free";
}

/**
 * Has this surface been positively established as suitable?
 *
 * `unknown` is not `eligible`. `isNSFW !== true` on a post is an absence of a
 * flag, not an affirmative signal about the post, its flyer, or what surrounds
 * it in the feed.
 */
export type SurfaceSuitability = "unknown" | "eligible" | "ineligible";

export interface AdEligibilityInput {
  /** Kill switch. `ads_google_native` / `ads_google_web`. */
  featureOn: boolean;
  viewer: AdViewer;
  /** Consent resolved and permitting a request (UMP on mobile, CMP on web). */
  privacyAllows: boolean;
  surfaceSuitable: SurfaceSuitability;
  /** DVNT's adult-content mode. No Google request is made while it is on. */
  spicyMode: boolean;
  /** The provider has real, verified configuration — not a placeholder id. */
  providerConfigured: boolean;
}

export function canRequestGoogleAd(input: AdEligibilityInput): boolean {
  return (
    input.featureOn &&
    input.viewer !== "unknown" &&
    input.viewer !== "paid" &&
    input.privacyAllows &&
    input.surfaceSuitable === "eligible" &&
    !input.spicyMode &&
    input.providerConfigured
  );
}

/**
 * Why a request was refused. For diagnostics and the kill-switch runbook —
 * "no ads showed" is unactionable without knowing which condition closed.
 */
export type AdRefusal =
  | "feature-off"
  | "viewer-unknown"
  | "viewer-paid"
  | "privacy"
  | "surface"
  | "spicy-mode"
  | "provider-unconfigured";

export function adRefusalReason(
  input: AdEligibilityInput,
): AdRefusal | null {
  if (!input.featureOn) return "feature-off";
  if (input.viewer === "unknown") return "viewer-unknown";
  if (input.viewer === "paid") return "viewer-paid";
  if (!input.privacyAllows) return "privacy";
  if (input.surfaceSuitable !== "eligible") return "surface";
  if (input.spicyMode) return "spicy-mode";
  if (!input.providerConfigured) return "provider-unconfigured";
  return null;
}

/**
 * Bumped whenever eligibility could have changed: upgrade, downgrade, account
 * switch, consent withdrawal, Spicy toggle, kill switch.
 *
 * An in-flight ad request that resolves after a bump belongs to a viewer who
 * may no longer be servable, so the response is dropped rather than mounted.
 * Without this, upgrading mid-session shows the newly-paid member one more ad —
 * the response was already on the wire when they paid.
 */
export function isAdResponseStale(
  requestedAtGeneration: number,
  currentGeneration: number,
): boolean {
  return requestedAtGeneration !== currentGeneration;
}

/**
 * Subscription copy. Both halves, always — promising an ad-free feed would be
 * a promise DVNT's own promoted events break.
 */
export const AD_FREE_BENEFIT = {
  title: "No Google ads",
  detail: "Promoted events may still appear.",
} as const;
