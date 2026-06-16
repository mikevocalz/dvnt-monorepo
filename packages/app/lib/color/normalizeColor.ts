/**
 * normalizeColor — turn a platform palette result into ONE representative hex,
 * matching the flyer-color edge fn's intent (the edge fn averages non-transparent
 * pixels → a single mid-tone hex). The on-device palette APIs return several
 * labelled swatches instead, so we pick the swatch that best stands in for that
 * average — the most *populous* one (the color that covers the most of the image),
 * not the most vivid — so db-sourced and client-extracted colors look coherent in
 * <EventFlyer>.
 *
 * Web extracts a true pixel average on a canvas (see extractDominantColor.web),
 * so it already matches the edge fn — no swatch picking needed there. Native uses
 * react-native-image-colors, which only returns swatches; fromImageColors picks
 * the field closest to the average (Android exposes a real `average`).
 */

export const FALLBACK_COLOR = "#101321"; // brand ink — the EventFlyer base/gradient anchor

/**
 * Input for the platform extractors + the hook. Lives here (a non-split module)
 * rather than in extractDominantColor.ts so the .web/.native files can import it
 * without `./extractDominantColor` resolving back to themselves under
 * platform-suffix module resolution (moduleSuffixes).
 */
export interface ExtractInput {
  /** Best still to sample (video poster, else static flyer). Preferred. */
  imageUrl?: string | null;
  /** Video flyer — used only when there's no still (a frame is pulled first). */
  videoUrl?: string | null;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** Coerce any "#rgb"/"#rrggbb"/"rgb(...)" to lowercase "#rrggbb", else null. */
export function normalizeHex(input: string | null | undefined): string | null {
  if (!input) return null;
  let v = input.trim().toLowerCase();
  if (HEX_RE.test(v)) return v;
  // #rgb shorthand
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(v);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  // rgb(r, g, b)
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(v);
  if (rgb) {
    const h = (n: string) => Math.max(0, Math.min(255, parseInt(n, 10))).toString(16).padStart(2, "0");
    return `#${h(rgb[1])}${h(rgb[2])}${h(rgb[3])}`;
  }
  return null;
}

/**
 * react-native-image-colors result → representative hex. The shape differs per
 * platform (`result.platform`): Android exposes `average`/`dominant`, iOS
 * `background`/`primary`, web `vibrant`/`darkVibrant`. We map each to the field
 * that best approximates the pixel-average.
 */
export function fromImageColors(result: Record<string, string> | null | undefined): string | null {
  if (!result) return null;
  const platform = result.platform;
  const pick =
    platform === "android"
      ? result.average || result.dominant || result.vibrant
      : platform === "ios"
        ? result.background || result.primary || result.detail
        : result.vibrant || result.darkVibrant || result.muted; // web
  return normalizeHex(pick || result.dominant || result.background || null);
}
