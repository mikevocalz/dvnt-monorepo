/**
 * The side-menu look, in one place.
 *
 * These are the web rail's values (`components/app-shell.web.tsx`) expressed
 * as tokens so the phone drawer and the desktop rail cannot drift into two
 * different menus. Anything here that exists in `lib/theme/tokens.ts` is read
 * from there rather than re-typed — `ACCENT` on web is `#379ED8`, which is
 * `color.cyan`.
 */

import { color, radius } from "@dvnt/app/lib/theme";

export const drawerTheme = {
  /** Liquid glass: translucent base, top-light sheen, heavy saturated blur. */
  surface: {
    /** `backgroundColor: rgba(10,12,22,0.42)` on web, over the blur. */
    base: "rgba(10,12,22,0.62)",
    /** The sheen gradient's stops, top to bottom. */
    sheen: [
      "rgba(255,255,255,0.06)",
      "rgba(255,255,255,0.015)",
      "rgba(255,255,255,0)",
    ] as const,
    sheenLocations: [0, 0.22, 0.6] as const,
    /** `borderRight: 1px solid rgba(255,255,255,0.10)` */
    edge: color.hairline,
    blurIntensity: 42,
  },
  row: {
    /** `padding: 13px 16px` — 50pt tall, clear of the 44pt minimum. */
    minHeight: 50,
    paddingHorizontal: 16,
    /** `gap: 16` between icon and label. */
    gap: 16,
    /** `gap: 10` between rows. */
    spacing: 10,
    borderRadius: radius.md,
    iconSize: 24,
    fontSize: 15.5,
    letterSpacing: 0.2,
    activeBackground: "rgba(55,158,216,0.10)",
    /** `inset 2px 0 0 ACCENT` — a leading accent bar, not a filled pill. */
    activeBarWidth: 2,
    activeBarColor: color.cyan,
    activeIcon: color.cyan,
    inactiveIcon: "rgba(255,255,255,0.82)",
    activeLabel: "#FFFFFF",
    inactiveLabel: "rgba(255,255,255,0.92)",
    pressedBackground: "rgba(255,255,255,0.05)",
  },
  /** `padding: 2px 12px 20px` under the mark, then a 40px gap to row one. */
  logo: {
    paddingTop: 2,
    paddingHorizontal: 12,
    paddingBottom: 20,
    gapToRows: 40,
    width: 112,
    height: 43,
  },
  section: {
    labelColor: color.textFaint,
    labelSize: 11,
    labelLetterSpacing: 1.2,
    marginTop: 22,
    marginBottom: 8,
  },
} as const;
