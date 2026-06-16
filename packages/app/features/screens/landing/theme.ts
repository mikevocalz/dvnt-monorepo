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
  /** Core accents. */
  cyan: "#3FDCFF",
  purple: "#8A40CF",
  magenta: "#FF5BFC",
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

/** CSS gradient strings (web) and color-stop arrays (native linear-gradient libs). */
export const LANDING_GRADIENTS = {
  /** Deviant: purple → magenta. Used for CTAs / wordmark accents. */
  deviant: ["#8A40CF", "#FF5BFC"] as const,
  deviantCss: "linear-gradient(135deg, #8A40CF 0%, #FF5BFC 100%)",
  /** Brand: cyan → purple. */
  brand: ["#3FDCFF", "#8A40CF"] as const,
  brandCss: "linear-gradient(135deg, #3FDCFF 0%, #8A40CF 100%)",
  /** Ambient purple paint-light field (web radial). */
  ambientCss:
    "radial-gradient(60% 50% at 50% 40%, rgba(138,64,207,0.38) 0%, rgba(124,58,237,0.18) 35%, rgba(2,3,10,0) 75%)",
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
