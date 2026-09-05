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

import { useSafeAreaInsets } from "react-native-safe-area-context";

/** Height of the floating tab pill plus the gap it leaves under itself. */
export const TAB_BAR_CLEARANCE = 56;

/** Padding that puts the last row clear of the floating tab bar. */
export function useTabBarInset(extra = 0): number {
  const insets = useSafeAreaInsets();
  return insets.bottom + TAB_BAR_CLEARANCE + extra;
}
