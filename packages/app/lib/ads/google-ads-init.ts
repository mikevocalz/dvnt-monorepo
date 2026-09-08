/**
 * Web has no Google Mobile Ads SDK — AdSense is a script tag, and it is
 * inserted by the web renderer inside the same eligibility gate rather than
 * here. This keeps the import site identical on both platforms.
 */

import type { AdEligibilityInput } from "./ad-eligibility";

export function invalidateAdEligibility(): void {}
export function isGoogleAdsInitialized(): boolean {
  return false;
}
export async function ensureGoogleAdsInitialized(
  _eligibility: AdEligibilityInput,
): Promise<boolean> {
  return false;
}
