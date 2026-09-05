import type { ReactNode } from "react";
import { View } from "react-native";
import { useIsLargeScreen } from "@dvnt/app/lib/hooks/use-is-large-screen";

/** Content column for routed screens. Pair with `useScreenGutter()`. */
export const SCREEN_SHELL = "flex-1 bg-background w-full max-w-4xl self-center";

/**
 * Horizontal breathing room inside the column, on tablets only.
 * 24 = DVNT spacing scale step. Phones get 0 so media stays edge-to-edge.
 */
export const SCREEN_GUTTER = 24;


/**
 * The content column every routed screen sits in.
 *
 * Owns two things so they cannot drift across screens:
 *   - the width cap (max-w-4xl, centred)
 *   - the tablet gutter (SCREEN_GUTTER, phones get 0)
 *
 * The gutter is applied here rather than in each list's
 * contentContainerStyle: several screens already set their own content padding,
 * and adding a second one would double it. Padding the column instead insets
 * the whole surface consistently and leaves each list's internal rhythm alone.
 *
 * `fullWidth` opts out of the cap for media grids, which want the tablet's full
 * width (the masonry feed). They keep the gutter at 0 so cells stay
 * edge-to-edge.
 */
export function ScreenShell({
  children,
  fullWidth = false,
}: {
  children: ReactNode;
  fullWidth?: boolean;
}) {
  const isLargeScreen = useIsLargeScreen();
  const paddingHorizontal = fullWidth || !isLargeScreen ? 0 : SCREEN_GUTTER;

  // One layer. The full-bleed backdrop is expo.backgroundColor (the RN root
  // view), set to ink in app.config.js — that is behind every React view,
  // including the native container NativeTabs hosts each screen in, so a
  // per-screen wrapper is not needed to fill the gutters.
  return (
    <View
      className={fullWidth ? "flex-1 bg-background w-full" : SCREEN_SHELL}
      style={paddingHorizontal ? { paddingHorizontal } : undefined}
    >
      {children}
    </View>
  );
}

/**
 * Horizontal gutter for screens that keep their own <View> because they carry
 * extra props (safe-area insets, edges) and cannot swap to <ScreenShell>.
 * Returns undefined on phones so no style object is created.
 */
export function useScreenGutter(): { paddingHorizontal: number } | undefined {
  const isLargeScreen = useIsLargeScreen();
  return isLargeScreen ? { paddingHorizontal: SCREEN_GUTTER } : undefined;
}
