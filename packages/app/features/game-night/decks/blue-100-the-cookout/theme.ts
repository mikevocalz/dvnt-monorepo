/**
 * Blue 100 — The Cookout: deck theme.
 *
 * Values sampled from the printed deck (`Blue 100 - The Cookout - Deckpdf.pdf`,
 * `Blue - The Cookout - Backcard.jpg`): white face, navy ink, solid navy rules
 * and bottom band; the back is the printed JPEG art, never a redraw.
 *
 * BC Barell Extended Black/Regular is the print typeface; the app uses the
 * repo-licensed SpaceGrotesk family until the Barell embedding licence is
 * confirmed (docs/game-night/g0-typography.md tracks that decision).
 */
export const COOKOUT_THEME = {
  /** Card aspect — 2.5 × 3.5 in poker size. */
  aspect: 5 / 7,
  colors: {
    face: "#ffffff",
    ink: "#141414",
    navy: "#283C81",
    navyDeep: "#1F347C",
    band: "#283C81",
    winnerGold: "#d9a419",
  },
  fonts: {
    display: "SpaceGrotesk-Bold",
    label: "SpaceGrotesk-SemiBold",
    body: "SpaceGrotesk-Regular",
    bodyStrong: "SpaceGrotesk-SemiBold",
  },
  /** Texture resolution for one card face — print is 750×1050 @300ppi. */
  texture: { width: 750, height: 1050 },
} as const;

export const COOKOUT_BACK_URL = "/game-night/cookout-back.jpg";
