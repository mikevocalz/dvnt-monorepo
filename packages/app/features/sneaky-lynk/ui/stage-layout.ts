/**
 * Geometry for the Sneaky Lynk stage — host hero and crowd tiles.
 *
 * Both bugs this module fixes were the same mistake in two places: a size
 * chosen on one axis while the other axis kept a value that no longer agreed
 * with it.
 *
 *   Host — the hero was always `pageWidth` wide, with only its HEIGHT capped
 *   to a share of the screen. In portrait the cap rarely binds, so nobody saw
 *   it. On a landscape tablet the cap binds hard: 1342pt wide against a 450pt
 *   cap is a 2.98:1 letterbox, and a webcam feed inside it is cropped to a
 *   slot. Capping height has to narrow the width to match, so the hero stays
 *   16:9 and centres in the space it was given.
 *
 *   Crowd — columns were fixed at 2 at every width, so a 1024pt iPad drew the
 *   phone layout at twice the scale: two 496x237 slabs per row. Width decides
 *   how many columns FIT, which is the same rule the flat grid already used
 *   (see `gridColumns`) and the same one the web stage uses in stage-grid.ts.
 *
 * A phone is deliberately untouched by all of it: at 390pt `crowdColumns`
 * still returns 2 and the aspect clamp never binds. This was a tablet fix,
 * not a redesign — `stage-layout.test.ts` pins that.
 */

/** Webcam-native landscape, for the host hero. */
export const HERO_ASPECT = 16 / 9;

/**
 * Widest a crowd tile may get before it stops reading as a person and starts
 * reading as a strip. Tiles are free to be TALLER than this (a phone's 2-up
 * column is portrait and always was); the clamp only stops them stretching.
 */
export const MAX_TILE_ASPECT = 16 / 9;

/** At and above this a screen is a tablet rather than a large phone. */
export const TABLET_MIN_WIDTH = 700;

/** At and above this there is room for a fourth column of faces. */
export const WIDE_MIN_WIDTH = 1000;

/**
 * Below this a tile stops reading as a face and starts reading as a chip.
 * 120 is what a 390pt phone already produced at 3 columns, so this floor
 * constrains narrow screens without reflowing phones.
 */
export const MIN_TILE_WIDTH = 120;

export interface Box {
  width: number;
  height: number;
}

/** Columns of crowd tiles that fit at this width. */
export function crowdColumns(width: number): number {
  if (width >= WIDE_MIN_WIDTH) return 4;
  if (width >= TABLET_MIN_WIDTH) return 3;
  return 2;
}

/**
 * Columns for the flat participant grid, where headcount also has a say.
 * Width decides how many columns FIT; count decides how many are WANTED;
 * the layout takes the smaller.
 */
export function gridColumns(count: number, width: number): number {
  const isTablet = width >= TABLET_MIN_WIDTH;
  const maxCols = Math.max(1, Math.floor(width / MIN_TILE_WIDTH));
  const fit = (wanted: number) => Math.max(1, Math.min(wanted, maxCols));
  if (count <= 1) return 1;
  // Two people stack on a phone and sit side by side on a tablet, where a
  // full-width tile would be a letterbox strip.
  if (count === 2) return isTablet ? 2 : 1;
  if (count <= 6) return fit(isTablet ? 3 : 2);
  return fit(isTablet ? 4 : 3);
}

/**
 * The host hero at a true 16:9 inside the space it is allowed.
 *
 * `maxHeight` is the cap the stage puts on the hero so the crowd keeps room.
 * When that cap binds, the width comes down with it rather than staying full
 * bleed — that is the whole point of this function.
 */
export function heroBox(pageWidth: number, maxHeight: number): Box {
  const height = Math.max(
    0,
    Math.min(Math.round(pageWidth / HERO_ASPECT), Math.round(maxHeight)),
  );
  const width = Math.min(pageWidth, Math.round(height * HERO_ASPECT));
  return { width: Math.max(0, width), height };
}

/**
 * One crowd tile, filling its slot's height and clamped so it can never
 * stretch past `MAX_TILE_ASPECT`. Callers centre the row: a clamped tile is
 * narrower than its slot, and left-aligning it would just move the gap.
 */
export function crowdTileBox(
  pageWidth: number,
  tilesAreaHeight: number,
  cols: number,
  rows: number,
  gap: number,
): Box {
  const safeCols = Math.max(1, cols);
  const safeRows = Math.max(1, rows);
  const slotWidth = Math.floor(
    (pageWidth - gap * (safeCols - 1)) / safeCols,
  );
  const slotHeight = Math.floor(
    (tilesAreaHeight - gap * (safeRows - 1)) / safeRows,
  );
  const width = Math.min(slotWidth, Math.floor(slotHeight * MAX_TILE_ASPECT));
  return { width: Math.max(0, width), height: Math.max(0, slotHeight) };
}
