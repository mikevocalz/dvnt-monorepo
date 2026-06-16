/**
 * TabletTabBar — Vertical right-rail tab bar for tablets / large screens.
 *
 * Layout:
 *   ┌──────────┐
 *   │          │
 *   │  (flex)  │
 *   │  ┌────┐  │  ← CenteredItems (vertically centered)
 *   │  │ 🏠 │  │
 *   │  │ 📅 │  │
 *   │  │ ❤️ │  │
 *   │  │ 👤 │  │
 *   │  └────┘  │
 *   │  (flex)  │
 *   │          │
 *   │  ┌────┐  │  ← BottomAction (absolute, bottom: 30 + insets)
 *   │  │ ➕ │  │
 *   │  └────┘  │
 *   └──────────┘
 */

import React, { useCallback, useMemo } from "react";
import { View, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import * as Haptics from "expo-haptics";
import { useColorScheme } from "@/lib/hooks";
import { CenterButton } from "@/components/center-button";
import { Plus } from "lucide-react-native";
import { partitionRoutes, TABLET_RAIL_WIDTH } from "./constants";
import { prefetchForRoute } from "@/lib/perf/prefetch-router";
import { useQueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/lib/stores/auth-store";

export function TabletTabBar({
  state,
  descriptors,
  navigation,
}: BottomTabBarProps) {
  const insets = useSafeAreaInsets();
  const { colors } = useColorScheme();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.user?.id) || "";

  const { regularRoutes, specialRoute } = useMemo(
    () => partitionRoutes(state.routes, descriptors),
    [state.routes, descriptors],
  );

  const handleTabPress = useCallback(
    (route: (typeof state.routes)[number], isFocused: boolean) => {
      const event = navigation.emit({
        type: "tabPress",
        target: route.key,
        canPreventDefault: true,
      });

      if (!event.defaultPrevented && !isFocused) {
        navigation.navigate(route.name, route.params);
      }
    },
    [navigation],
  );

  const handleTabLongPress = useCallback(
    (route: (typeof state.routes)[number]) => {
      navigation.emit({
        type: "tabLongPress",
        target: route.key,
      });
    },
    [navigation],
  );

  const handleSpecialPress = useCallback(() => {
    if (!specialRoute) return;
    const event = navigation.emit({
      type: "tabPress",
      target: specialRoute.key,
      canPreventDefault: true,
    });
    if (!event.defaultPrevented) {
      navigation.navigate(specialRoute.name, specialRoute.params);
    }
  }, [navigation, specialRoute]);

  return (
    <View
      style={[
        styles.rail,
        {
          backgroundColor: colors.background,
          borderLeftColor: colors.border,
          paddingTop: insets.top,
          width: TABLET_RAIL_WIDTH,
        },
      ]}
    >
      {/* Centered regular tabs */}
      <View style={styles.centeredItems}>
        {regularRoutes.map((route) => {
          const descriptor = descriptors[route.key];
          if (!descriptor) return null;

          const { options } = descriptor;
          const isFocused = state.index === state.routes.indexOf(route);

          const icon = options.tabBarIcon?.({
            focused: isFocused,
            color: isFocused ? colors.foreground : colors.mutedForeground,
            size: 26,
          });

          return (
            <Pressable
              key={route.key}
              accessibilityRole="button"
              accessibilityState={{ selected: isFocused }}
              accessibilityLabel={options.tabBarAccessibilityLabel}
              testID={options.tabBarButtonTestID}
              onPress={() => {
                Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                if (!isFocused && userId) {
                  prefetchForRoute(queryClient, userId, route.name);
                }
                handleTabPress(route, isFocused);
              }}
              onLongPress={() => handleTabLongPress(route)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={[
                styles.railItem,
                isFocused && {
                  backgroundColor: colors.border,
                },
              ]}
            >
              {icon}
            </Pressable>
          );
        })}
      </View>

      {/* Special action button — pinned to bottom */}
      {specialRoute && (
        <View style={[styles.bottomAction, { bottom: 30 + insets.bottom }]}>
          <CenterButton Icon={Plus} onPress={handleSpecialPress} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  rail: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    borderLeftWidth: 1,
    alignItems: "center",
  },
  centeredItems: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    gap: 8,
  },
  railItem: {
    width: 52,
    height: 52,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
  },
  bottomAction: {
    position: "absolute",
    alignItems: "center",
    width: "100%",
  },
});
