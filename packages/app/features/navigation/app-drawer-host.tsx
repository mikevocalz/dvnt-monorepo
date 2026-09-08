/**
 * Hosts the drawer around the protected Stack.
 *
 * Uses `react-native-drawer-layout` — the layout `@react-navigation/drawer`
 * (and therefore expo-router's bundled `Drawer`) is itself built on, already
 * resolved at 4.2.5 through expo-router. Taking the layout directly rather than
 * the navigator is deliberate:
 *
 * - The navigator is a route layout, so adopting it would mean restructuring
 *   `(protected)` and pushing `(tabs)` down a level — breaking every
 *   `/(protected)/(tabs)/...` path, every deep link, and the TransitionStack's
 *   shared-element screen names.
 * - As a plain controlled component it wraps the existing Stack as `children`.
 *   The Stack's element identity does not change when `open` flips, so opening
 *   the drawer cannot remount the feed, reset scroll, drop a call, or
 *   re-run a query.
 * - There is still exactly one NavigationContainer, the one expo-router owns.
 *
 * §8 of the brief permits "Expo Router's bundled drawer or its supported
 * underlying layout"; this is the latter.
 */

import { useCallback, useEffect } from "react";
import { BackHandler, Platform, useWindowDimensions } from "react-native";
import { Drawer } from "react-native-drawer-layout";
import { usePathname } from "expo-router";
import { useDrawerStore } from "@dvnt/app/lib/stores/drawer-store";
import { color } from "@dvnt/app/lib/theme";
import { AppDrawerContent } from "./app-drawer";
import { drawerGestureEnabled } from "./drawer-destinations";

/** Panel width: readable rows without swallowing the screen on a small phone. */
const MAX_PANEL_WIDTH = 320;

export function AppDrawerHost({ children }: { children: React.ReactNode }) {
  const open = useDrawerStore((s) => s.open);
  const openDrawer = useDrawerStore((s) => s.openDrawer);
  const closeDrawer = useDrawerStore((s) => s.closeDrawer);
  const pathname = usePathname();
  const { width } = useWindowDimensions();

  const panelWidth = Math.min(MAX_PANEL_WIDTH, Math.round(width * 0.86));

  // Android Back closes the drawer before it pops a screen.
  useEffect(() => {
    if (!open || Platform.OS !== "android") return;
    const subscription = BackHandler.addEventListener(
      "hardwareBackPress",
      () => {
        closeDrawer();
        return true;
      },
    );
    return () => subscription.remove();
  }, [closeDrawer, open]);

  // Web: Escape closes, the way every other dismissible surface does.
  useEffect(() => {
    if (Platform.OS !== "web" || !open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeDrawer();
    };
    globalThis.addEventListener?.("keydown", onKey);
    return () => globalThis.removeEventListener?.("keydown", onKey);
  }, [closeDrawer, open]);

  // A screen that owns the horizontal swipe keeps it. Checkout, the scanner,
  // stories, the camera, live calls and editors all lose real work to a
  // drawer that opens over them.
  const swipeEnabled = drawerGestureEnabled(pathname);

  const renderDrawerContent = useCallback(() => <AppDrawerContent />, []);

  return (
    <Drawer
      open={open}
      onOpen={openDrawer}
      onClose={closeDrawer}
      renderDrawerContent={renderDrawerContent}
      // `front` puts the panel over a scrim rather than sliding the app, so the
      // content underneath never re-lays-out — the cheapest way to guarantee
      // no reflow of a masonry feed mid-gesture.
      drawerType="front"
      swipeEnabled={swipeEnabled}
      swipeEdgeWidth={40}
      // Defaults to `rtl` when I18nManager.isRTL, which puts the panel on the
      // right and reverses the gesture. Left it to the library on purpose.
      drawerStyle={{
        width: panelWidth,
        backgroundColor: color.ink,
      }}
      overlayStyle={{ backgroundColor: "rgba(0,0,0,0.55)" }}
      overlayAccessibilityLabel="Close menu"
      keyboardDismissMode="on-drag"
    >
      {children}
    </Drawer>
  );
}
