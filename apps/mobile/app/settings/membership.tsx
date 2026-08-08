/**
 * Unlike the sibling pure re-export routes, this one injects the RevenueCat
 * billing seam: react-native-purchases is an apps/mobile dependency
 * (lib/billing/revenuecat.ts), and packages/app never imports across the app
 * boundary — so the route file is where the two meet.
 */
import MembershipSettingsScreen from "@dvnt/app/features/routes/screens/settings/membership";
import {
  getMembershipPackages,
  purchaseMembershipPackage,
  restoreMembershipPurchases,
} from "@/lib/billing/revenuecat";

const billing = {
  getMembershipPackages,
  purchaseMembershipPackage,
  restoreMembershipPurchases,
};

export default function MembershipRoute() {
  return <MembershipSettingsScreen billing={billing} />;
}
