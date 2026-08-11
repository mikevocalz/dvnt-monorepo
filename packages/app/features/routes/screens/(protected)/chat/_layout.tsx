"use client";

import { Stack } from "expo-router";

/**
 * Chat is presented as a sheet, but NOT via TrueSheet's navigator.
 *
 * This used to render <AppSheet />, which mounts
 * createTrueSheetNavigator()'s Navigator through withLayoutContext. That
 * navigator calls useNavigationBuilder -> useRegisterNavigator, which threw
 *   "Couldn't register the navigator. Have you wrapped your app with
 *    'NavigationContainer'?"
 * on EVERY app launch — the root ErrorBoundary caught it as `Screen: App`, so
 * the whole app fell over, taking the inbox with it.
 *
 * It is not a duplicate-package problem, despite what that error suggests:
 * expo-router, @lodev09/react-native-true-sheet, packages/app and apps/mobile
 * all resolve one and the same @react-navigation/core (7.19.0) and
 * @react-navigation/native (7.3.0), and true-sheet's `@react-navigation/native
 * >=7` peer is satisfied. Confirmed by swapping this one file to Stack: the
 * error count went to zero and Messages rendered (ttuc=78ms, cache=HIT).
 *
 * Stack + formSheet gives the same sheet UX through react-native-screens'
 * native presentation, with no third-party navigator in the tree. Detent and
 * grabber match the old AppSheet defaults (detents [0.75], 16pt corners).
 */
export default function ChatLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        presentation: "formSheet",
        sheetAllowedDetents: [0.75],
        sheetGrabberVisible: true,
        sheetCornerRadius: 16,
        contentStyle: { backgroundColor: "#000" },
      }}
    />
  );
}
