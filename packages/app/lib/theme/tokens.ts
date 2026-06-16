/**
 * DVNT design tokens — the single cross-platform source of truth for color,
 * gradient, spacing, radius, and elevation. Pairs with `typography.ts` (text)
 * and `motion.ts`. Consumed by NativeWind (native) + the web Tailwind/raw-tag
 * layer; see `docs/dvnt-design-system.md` for the rationale.
 *
 * Every value here is the brand's REAL in-code value (verified by count across
 * packages/app + apps/web), not invented. Hex is canonical; rgba surfaces use
 * white-alpha so they read on the near-black `ink` base.
 */

/** Core palette. */
export const color = {
  ink: "#06070D", // app background
  inkDeep: "#02030A", // deepest bg, scrims, OG cards
  surface: "rgba(255,255,255,0.04)", // cards, rows
  surface2: "rgba(255,255,255,0.08)", // pressed/hover, chips
  hairline: "rgba(255,255,255,0.10)", // borders, dividers
  cyan: "#3FDCFF", // gradient stop 1, primary accent
  violet: "#8A40CF", // gradient stop 2
  magenta: "#FF5BFC", // gradient stop 3, social/likes
  signal: "#FC253A", // live / destructive / close-friends
  gold: "#F5C518", // ratings, Early-Bird "price goes up"
  text: "#FFFFFF",
  textDim: "rgba(255,255,255,0.60)",
  textFaint: "rgba(255,255,255,0.40)",
} as const;
export type ColorName = keyof typeof color;

/** The Deviant Gradient — the one brand stroke. Spent only on the signature
 * moments (primary CTA, price-from chip, unseen "going" ring, header hairline,
 * "Promoted" hairline). Never a section background. */
export const gradient = {
  deviantStops: [color.cyan, color.violet, color.magenta] as const,
  /** CSS / web. */
  deviantCss: `linear-gradient(100deg, ${color.cyan} 0%, ${color.violet} 52%, ${color.magenta} 100%)`,
  /** expo-linear-gradient props (native). */
  deviantNative: {
    colors: [color.cyan, color.violet, color.magenta] as const,
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
  },
} as const;

/** 4-base spacing scale (px). */
export const space = {
  px2: 2, px4: 4, px8: 8, px12: 12, px16: 16,
  px20: 20, px24: 24, px32: 32, px40: 40, px56: 56,
} as const;

/** Radius scale. No pills for content; avatars are rounded squares (`lg`/`xl`),
 * never circular. `full` is reserved for status dots + the camera shutter. */
export const radius = {
  sm: 8, md: 12, lg: 16, xl: 20, "2xl": 24, full: 9999,
} as const;
export type RadiusName = keyof typeof radius;

/** Depth is hairlines + one liquid-glass header, not drop-shadows everywhere. */
export const glass = {
  bg: "rgba(8,10,18,0.72)", // ink @ 72%
  backdropFilter: "saturate(160%) blur(18px)",
} as const;
