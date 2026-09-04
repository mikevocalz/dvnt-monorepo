/**
 * How many columns the web stage uses for N people.
 *
 * The stage used to be "host huge on top, everyone else in a 5-up strip".
 * Once every joiner publishes, that reads as one important person and four
 * thumbnails — which is not what a five-person room is. Zoom, Teams, Circle
 * and Riverside all draw the same thing at this headcount: ONE uniform grid,
 * equal tiles, with the active speaker ringed rather than enlarged. Spotlight
 * is a mode you choose, not the default you get for being the host.
 *
 * Count decides how many columns are WANTED; the breakpoint decides how many
 * FIT. Same rule as the native grid (see grid-layout.test.ts) so the two rails
 * do not drift into different rooms.
 */
export function stageGridClass(count: number): string {
  if (count <= 1) return "grid-cols-1";
  if (count === 2) return "grid-cols-1 sm:grid-cols-2";
  if (count <= 4) return "grid-cols-2";
  if (count <= 9) return "grid-cols-2 sm:grid-cols-3";
  return "grid-cols-2 sm:grid-cols-3 md:grid-cols-4";
}

/**
 * Cap the grid's width so tiles stay `aspect-video` without overflowing a tall
 * viewport. `22rem` is the chrome above and below the stage (header, disclosure,
 * audience row, controls).
 */
export function stageMaxWidthStyle(count: number, columns: number): string {
  const rows = Math.max(1, Math.ceil(count / columns));
  // width = availableHeight * (16/9) * cols / rows
  return `min(100%, calc((100dvh - 22rem) * ${(16 * columns) / (9 * rows)}))`;
}

/** Columns the class above resolves to at a given viewport width. */
export function stageColumns(count: number, width: number): number {
  const sm = width >= 640;
  const md = width >= 768;
  if (count <= 1) return 1;
  if (count === 2) return sm ? 2 : 1;
  if (count <= 4) return 2;
  if (count <= 9) return sm ? 3 : 2;
  return md ? 4 : sm ? 3 : 2;
}
