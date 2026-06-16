/**
 * Shared constants and helpers for PhoneTabBar and TabletTabBar.
 */

import { Platform } from "react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import type { Route } from "@react-navigation/native";

/** The route name of the special "create" action button. */
export const SPECIAL_TAB_NAME = "create";

/** Tab bar dimensions */
export const PHONE_TAB_BAR_HEIGHT = Platform.OS === "android" ? 40 : 60;
export const TABLET_RAIL_WIDTH = 72;

/** Determine whether a route should be rendered as a tab. */
export function isTabVisible(
  route: Route<string>,
  descriptors: BottomTabBarProps["descriptors"],
): boolean {
  const descriptor = descriptors[route.key];
  if (!descriptor) return false;
  const opts = descriptor.options;
  // Hidden if tabBarButton explicitly returns null
  if (opts.tabBarButton === null) return false;
  // Hidden if tabBarStyle display is "none"
  const style = opts.tabBarStyle as Record<string, unknown> | undefined;
  if (style && style.display === "none") return false;
  // Hidden if tabBarItemStyle display is "none"
  const itemStyle = opts.tabBarItemStyle as Record<string, unknown> | undefined;
  if (itemStyle && itemStyle.display === "none") return false;
  return true;
}

/** Check if a route is the special action tab. */
export function isSpecialTab(route: Route<string>): boolean {
  return route.name === SPECIAL_TAB_NAME;
}

/** Split routes into regular tabs and the special tab. */
export function partitionRoutes(
  routes: Route<string>[],
  descriptors: BottomTabBarProps["descriptors"],
): {
  regularRoutes: Route<string>[];
  specialRoute: Route<string> | null;
} {
  const regularRoutes: Route<string>[] = [];
  let specialRoute: Route<string> | null = null;

  for (const route of routes) {
    if (!isTabVisible(route, descriptors)) continue;
    if (isSpecialTab(route)) {
      specialRoute = route;
    } else {
      regularRoutes.push(route);
    }
  }

  return { regularRoutes, specialRoute };
}
