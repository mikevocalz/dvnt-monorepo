/**
 * Normalize the iOS Apple Pay entitlement to the Stripe merchant ID DVNT uses
 * at runtime. The upstream Stripe config plugin appends merchant identifiers,
 * which can preserve stale IDs from an older entitlements file and make EAS
 * signing or Apple Pay startup inconsistent.
 */

const { withEntitlementsPlist } = require("expo/config-plugins");

const APPLE_PAY_ENTITLEMENT = "com.apple.developer.in-app-payments";
const MERCHANT_IDENTIFIER = "merchant.com.dvnt.app";

function withStripeMerchantEntitlement(config) {
  return withEntitlementsPlist(config, (entitlementsConfig) => {
    entitlementsConfig.modResults[APPLE_PAY_ENTITLEMENT] = [
      MERCHANT_IDENTIFIER,
    ];
    return entitlementsConfig;
  });
}

module.exports = withStripeMerchantEntitlement;
