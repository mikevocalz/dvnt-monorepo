/**
 * Bottom clearance for content that scrolls under the floating tab bar.
 *
 * `NativeTabs` draws a detached pill that hovers above the home indicator, so
 * `insets.bottom` alone is not enough — the last row of every list was landing
 * behind it. Measured on a 393x852pt device: the pill occupies roughly 72pt and
 * floats ~17pt off the bottom edge, so the content has to clear the inset plus
 * the pill.
 *
 * ponytail: one measured constant, not a layout-measuring hook. If the pill ever
 * becomes resizable, swap this for the real measurement — until then a
 * `onLayout` round-trip per screen buys nothing.
 */

import { Platform } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Height of the floating tab pill plus the gap it leaves under itself. */
export const TAB_BAR_CLEARANCE = 56;

/** Padding that puts the last row clear of the floating tab bar. */
export function useTabBarInset(extra = 0): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + TAB_BAR_CLEARANCE + extra;
}

/**
 * Height the tab bar occupies at the TOP of the screen, on iPad only.
 *
 * iPadOS does not put NativeTabs at the bottom — it renders them as a bar
 * across the top, floating over the screen's content. Every tab screen pads
 * only its bottom (above), so on a tablet the first row of every list rendered
 * underneath the tab bar and the bar covered it. Zero on iPhone, where the bar
 * really is at the bottom and this would be dead space.
 *
 * Measured on a 1024x1366pt iPad: the bar sits at y=90 and is 36pt tall, and
 * the header above it ends at ~76pt — so content needs ~52pt beyond the header
 * to clear it.
 *
 * ponytail: one measured constant, same as TAB_BAR_CLEARANCE. Swap for a real
 * measurement if the bar ever becomes resizable.
 */
export const TAB_BAR_TOP_CLEARANCE = 52;

/** Padding that puts the first row clear of the iPad's top tab bar. */
export function useTabBarTopInset(extra = 0): number {
  const isPad = Platform.OS === "ios" && Platform.isPad;
  return isPad ? TAB_BAR_TOP_CLEARANCE + extra : extra;
}
