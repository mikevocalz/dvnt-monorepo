/**
 * DVNT widget brand tokens (after-dark, glass, teal-blue + purple gradients).
 * Anchored to docs/dvnt-design-system.md. Kept as plain values so both the
 * widget layouts (@expo/ui, SwiftUI-backed) and the Live Activity share one
 * source of truth. Real logo gradient stops from the DVNT wordmark.
 */

export const DVNT = {
  // Surfaces — near-black.
  bg: "#05060B",
  bgElevated: "#0B0D16",
  hairline: "rgba(255,255,255,0.10)",

  // Text.
  text: "#FAFAF9",
  textSecondary: "#A3A3A3",
  textFaint: "#737373",

  // Brand gradient stops (teal-blue → purple), from the logo asset.
  tealDark: "#0f4961",
  teal: "#379ed8",
  cyan: "#3FDCFF",
  purple: "#874e9f",
  purpleDeep: "#5b2c81",
  magenta: "#FF5BFC",
} as const;

/** The teal-blue → purple wordmark gradient stops, in order. */
export const DVNT_GRADIENT = [DVNT.teal, DVNT.cyan, DVNT.magenta, DVNT.purple] as const;

/** Tier badge accent colors (Prompt 8 tiers). */
export const TIER_ACCENT: Record<string, string> = {
  founders: DVNT.magenta,
  vip: DVNT.purple,
  table: DVNT.teal,
  ga: DVNT.cyan,
  free: DVNT.textSecondary,
};

/** Custom display font bundled into the widget target; fallback still reads DVNT. */
export const DISPLAY_FONT = "Republica-Minor";

/** A safe accent from a per-event dominant color, falling back to brand cyan. */
export function accentColor(dominant?: string | null): string {
  if (dominant && /^#?[0-9a-fA-F]{6}$/.test(dominant.replace("#", ""))) {
    return dominant.startsWith("#") ? dominant : `#${dominant}`;
  }
  return DVNT.cyan;
}
