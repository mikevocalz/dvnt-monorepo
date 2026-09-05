/**
 * The settings group's own stack.
 *
 * Without this file `settings/` was not a route at all — only `settings/index`,
 * `settings/watch`, … as loose siblings of the ROOT stack. Two things followed:
 * the root's `<Stack.Screen name="settings">` (fullScreenModal, slide-from-
 * bottom) matched nothing, and every settings screen inherited the root's
 * `headerShown: false` and then flipped it to `true` in its own
 * `useLayoutEffect`. Toggling a modal's header visibility remounts the screen —
 * which re-runs the effect — so `/settings` painted nothing at all and RN
 * warned "Dynamically changing header's visibility in modals will result in
 * remounting the screen".
 *
 * Declaring the header ON here makes each screen's `setOptions` a no-op change
 * instead of a remount, and gives the root stack a real `settings` route to
 * present.
 */

import { Stack } from "expo-router";
import { useColorScheme } from "@dvnt/app/lib/hooks";

export default function SettingsLayout() {
  const { colors } = useColorScheme();

  return (
    <Stack
      screenOptions={{
        headerShown: true,
        headerBackButtonDisplayMode: "minimal",
        headerTintColor: colors.foreground,
        headerStyle: { backgroundColor: colors.background },
        headerTitleStyle: {
          color: colors.foreground,
          fontWeight: "600",
          fontSize: 17,
        },
        headerShadowVisible: false,
        contentStyle: { backgroundColor: colors.background },
      }}
    />
  );
}
