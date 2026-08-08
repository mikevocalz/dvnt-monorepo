/**
 * Unlike the sibling pure re-export routes, this one injects the RevenueCat
 * billing seam (same pattern as app/settings/membership.tsx):
 * react-native-purchases is an apps/mobile dependency
 * (lib/billing/revenuecat.ts), and packages/app never imports across the app
 * boundary — so the route file is where the two meet. The seam feeds the
 * SneakySubscriptionModal (time-up paywall) inside the room screen.
 */
import SneakyLynkRoomScreen from '@dvnt/app/features/routes/screens/(protected)/sneaky-lynk/room/[id]';
import {
  getSneakyPackages,
  purchaseMembershipPackage,
  restoreMembershipPurchases,
} from '@/lib/billing/revenuecat';

// Keep re-exporting the route extras (ErrorBoundary) expo-router reads.
export * from '@dvnt/app/features/routes/screens/(protected)/sneaky-lynk/room/[id]';

const billing = {
  getSneakyPackages,
  purchaseMembershipPackage,
  restoreMembershipPurchases,
};

export default function SneakyLynkRoomRoute() {
  return <SneakyLynkRoomScreen billing={billing} />;
}
