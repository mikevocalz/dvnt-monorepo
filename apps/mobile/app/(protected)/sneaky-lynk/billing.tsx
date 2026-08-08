/**
 * Unlike the sibling pure re-export routes, this one injects the RevenueCat
 * billing seam (same pattern as app/settings/membership.tsx) so the
 * SneakySubscriptionModal can sell the standalone Sneaky tiers via IAP.
 */
import BillingScreen from '@dvnt/app/features/routes/screens/(protected)/sneaky-lynk/billing';
import {
  getSneakyPackages,
  purchaseMembershipPackage,
  restoreMembershipPurchases,
} from '@/lib/billing/revenuecat';

const billing = {
  getSneakyPackages,
  purchaseMembershipPackage,
  restoreMembershipPurchases,
};

export default function SneakyLynkBillingRoute() {
  return <BillingScreen billing={billing} />;
}
