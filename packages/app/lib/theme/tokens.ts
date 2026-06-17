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

/**
 * Core palette — refined to the DVNT Design Brief (docs/design-language.md):
 * the signature is the teal-blue → purple gradient glowing through glass on
 * "expensive darkness", NOT the old cyan/violet/magenta neon (which read as the
 * dating-app energy the brief refuses). Key NAMES are kept stable so the ~app
 * doesn't break; their VALUES are the brief's. `tealBlue`/`purple` are the
 * canonical accents; `magenta` is demoted to a functional like/love accent only.
 */
export const color = {
  ink: "#06070D", // app background
  inkDeep: "#02030A", // deepest bg, scrims, OG cards
  surface: "rgba(255,255,255,0.04)", // cards, rows
  surface2: "rgba(255,255,255,0.08)", // pressed/hover, chips
  hairline: "rgba(255,255,255,0.10)", // borders, dividers
  // Brief gradient anchors (teal-blue → purple).
  tealDeep: "#0F4961", // gradient stop 1 (deep teal)
  cyan: "#379ED8", // primary accent + gradient stop 2 (teal-blue; was #3FDCFF)
  violet: "#874E9F", // secondary accent + gradient stop 3 (purple; was #8A40CF)
  purpleDeep: "#5B2C81", // gradient stop 4 (deep purple)
  magenta: "#FF5BFC", // DEMOTED: functional like/love only, not the brand stroke
  signal: "#FC253A", // live / destructive / close-friends
  gold: "#F5C518", // ratings, Early-Bird "price goes up"
  text: "#FFFFFF",
  textDim: "rgba(255,255,255,0.60)",
  textFaint: "rgba(255,255,255,0.40)",
} as const;
export type ColorName = keyof typeof color;

/** The Deviant Gradient — the one brand stroke (brief: teal-blue → purple,
 * glows through glass, never a flat section background). Spent only on the
 * signature moments (primary CTA, price-from chip, unseen "going" ring, header
 * + "Promoted" hairline). */
export const gradient = {
  deviantStops: [color.tealDeep, color.cyan, color.violet, color.purpleDeep] as const,
  /** CSS / web. */
  deviantCss: `linear-gradient(100deg, ${color.tealDeep} 0%, ${color.cyan} 38%, ${color.violet} 72%, ${color.purpleDeep} 100%)`,
  /** expo-linear-gradient props (native). */
  deviantNative: {
    colors: [color.tealDeep, color.cyan, color.violet, color.purpleDeep] as const,
    start: { x: 0, y: 0 },
    end: { x: 1, y: 0 },
  },
  /** Ambient "glow through glass" radials — the brief's signature on dark.
   *  Use behind frosted glass / as a section ambient, never as a flat fill. */
  tealGlowCss: `radial-gradient(60% 80% at 25% 0%, rgba(55,158,216,0.22) 0%, transparent 70%)`,
  purpleGlowCss: `radial-gradient(60% 80% at 80% 20%, rgba(135,78,159,0.20) 0%, transparent 70%)`,
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
