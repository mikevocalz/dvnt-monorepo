/**
 * DVNT landing — brand tokens.
 *
 * The monorepo has no central theme/tailwind config; brand colors are otherwise
 * hardcoded per-component. We centralize the landing page's palette, gradients,
 * and motion curves here so sections share one source of truth instead of
 * scattering hex literals. Mirrors the de-facto app palette (see logo.web.tsx,
 * ticket/ui/TicketHeroCard.tsx).
 */
import { Easing } from "react-native-reanimated";

export const LANDING_COLORS = {
  /** Near-black canvas. */
  bg: "#02030A",
  bgElevated: "#080A14",
  /** Core accents — DVNT Design Brief teal-blue → purple (was cyan/magenta neon). */
  tealDeep: "#0F4961",
  cyan: "#379ED8", // teal-blue (brief), primary accent (was #3FDCFF)
  purple: "#874E9F", // brief purple (was #8A40CF)
  purpleDeep: "#5B2C81",
  magenta: "#FF5BFC", // demoted: like/love only, not the brand stroke
  violet: "#7C3AED",
  /** Text. */
  text: "#FAFAF9",
  textSecondary: "rgba(245,245,244,0.82)",
  textMuted: "rgba(231,229,228,0.60)",
  /** Glass surfaces (kept consistent with packages/app/lib/ui/glass.ts). */
  glassBorder: "rgba(255,255,255,0.18)",
  glassBorderStrong: "rgba(255,255,255,0.30)",
  // Liquid glass, not frosted: keep the scrim light so content refracts through
  // the blur instead of sitting behind an opaque dark panel.
  glassScrim: "rgba(8,12,20,0.28)",
  glassScrimStrong: "rgba(8,12,20,0.44)",
} as const;

/** CSS gradient strings (web) and color-stop arrays (native linear-gradient libs).
 *  DVNT Design Brief: the signature is teal-blue → purple, glowing through glass. */
export const LANDING_GRADIENTS = {
  /** Deviant (signature, CTAs / wordmark accents): teal-blue → purple. */
  deviant: ["#0F4961", "#379ED8", "#874E9F", "#5B2C81"] as const,
  deviantCss:
    "linear-gradient(135deg, #0F4961 0%, #379ED8 38%, #874E9F 72%, #5B2C81 100%)",
  /** Brand (teal-blue half). */
  brand: ["#0F4961", "#379ED8"] as const,
  brandCss: "linear-gradient(135deg, #0F4961 0%, #379ED8 100%)",
  /** Purple half. */
  purpleCss: "linear-gradient(135deg, #874E9F 0%, #5B2C81 100%)",
  /** Ambient paint-light field — teal-blue + purple glow refracting on dark. */
  ambientCss:
    "radial-gradient(55% 50% at 30% 35%, rgba(55,158,216,0.30) 0%, transparent 65%), radial-gradient(55% 55% at 78% 30%, rgba(135,78,159,0.28) 0%, rgba(91,44,129,0.14) 40%, rgba(2,3,10,0) 75%)",
} as const;

/**
 * Signature easing — the cinematic "settle" curve used across the page
 * (header glass, section entrances). Matches the spec's bezier(0.22,1,0.36,1).
 */
export const EASE_SETTLE = Easing.bezier(0.22, 1, 0.36, 1);

/** Header turn-to-glass thresholds (px of scroll). Hysteresis avoids flicker. */
export const HEADER = {
  engageY: 48,
  releaseY: 24, // engageY - 24
  durationMs: 400,
} as const;

/** Hero video — stable, unsigned Squarespace master playlist (HLS). */
export const HERO_VIDEO_PLAYLIST =
  "https://video.squarespace-cdn.com/content/v1/6970176c1abbac076dce861e/02368f0f-2bb0-4591-8831-9c099f3808f5/playlist.m3u8";
