/**
 * DVNT Membership Screen (native /settings/membership route)
 *
 * Mounts the membership paywall (Metro resolves the .native fork, which sells
 * via RevenueCat IAP). The billing seam is injected by the apps/mobile mirror
 * route file — packages/app never imports the RevenueCat wrapper across the
 * app boundary (see features/screens/membership/billing.ts).
 */

import { useLayoutEffect } from "react";
import { useNavigation } from "@react-navigation/native";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import { MembershipScreen } from "@dvnt/app/features/screens/membership/MembershipScreen";
import type { MembershipBilling } from "@dvnt/app/features/screens/membership/billing";

export default function MembershipSettingsScreen({
  billing = null,
}: {
  billing?: MembershipBilling | null;
}) {
  const navigation = useNavigation();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "DVNT Membership",
      headerBackButtonDisplayMode: "minimal",
      headerLeft: () => null,
      headerTintColor: "#fff",
      headerStyle: { backgroundColor: "#000" },
      headerTitleStyle: {
        color: "#fff",
        fontFamily: "Inter-SemiBold",
        fontSize: 17,
      },
      headerShadowVisible: false,
      headerRight: () => <SettingsCloseButton />,
    });
  }, [navigation]);

  return <MembershipScreen billing={billing} />;
}
