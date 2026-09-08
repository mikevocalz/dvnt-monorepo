/**
 * Google Mobile Ads SDK initialisation, behind the gate.
 *
 * §6 is explicit that suppression happens BEFORE initialisation, not before
 * render: "no request, no script, no SDK init". A paid subscriber's device
 * must never start the SDK, so this is the only place `MobileAds()` is touched
 * and it refuses unless `canRequestGoogleAd` says otherwise.
 *
 * The import is dynamic for the same reason. A static import pulls the native
 * module into the bundle graph and runs its module-level side effects on every
 * launch, including for the members who bought their way out of advertising.
 */

import {
  canRequestGoogleAd,
  type AdEligibilityInput,
} from "./ad-eligibility";

type MobileAdsModule = {
  default: () => {
    initialize: () => Promise<unknown>;
    setRequestConfiguration: (config: Record<string, unknown>) => Promise<void>;
  };
};

let initialized = false;
let inFlight: Promise<boolean> | null = null;

/**
 * Bumped whenever eligibility could have changed. An init that resolves after
 * a bump belongs to a viewer who may no longer be servable.
 */
let generation = 0;

export function invalidateAdEligibility(): void {
  generation += 1;
}

/** For tests and for the kill-switch runbook. */
export function isGoogleAdsInitialized(): boolean {
  return initialized;
}

/**
 * Initialise once, if allowed. Returns whether the SDK is usable.
 *
 * Never throws: a failure to start an advertising SDK must not take a screen
 * with it, and the caller's fallback is simply not to render an ad.
 */
export async function ensureGoogleAdsInitialized(
  eligibility: AdEligibilityInput,
): Promise<boolean> {
  if (initialized) return true;
  if (!canRequestGoogleAd(eligibility)) return false;
  if (inFlight) return inFlight;

  const startedAt = generation;

  inFlight = (async () => {
    try {
      const mod: MobileAdsModule = await import(
        "react-native-google-mobile-ads"
      );

      // Eligibility can change while the dynamic import resolves — an upgrade
      // completing mid-launch, or a kill switch closing.
      if (generation !== startedAt || !canRequestGoogleAd(eligibility)) {
        return false;
      }

      await mod.default().initialize();
      initialized = true;
      return true;
    } catch (error) {
      console.warn("[ads] Google Mobile Ads init failed (continuing):", error);
      return false;
    } finally {
      inFlight = null;
    }
  })();

  return inFlight;
}
