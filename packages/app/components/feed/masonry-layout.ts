/**
 * Masonry layout maths — pure, no React and no react-native imports, so it can
 * be unit-tested with the repo's `node --import tsx --test` runner. The feed
 * component owns rendering; this owns how many columns there are and which
 * column each post lands in.
 */

/** Gap between and around columns, in points. */
export const COLUMN_GAP = 3;

// Two columns on a phone. A tablet has the width for more, and at 1024pt two
// columns produced ~500pt cells — posters, not a grid. Derived from width so a
// split-view / Stage Manager resize re-flows instead of staying phone-shaped.
export const PHONE_COLUMNS = 2;
export const TABLET_COLUMNS = 3;
export const WIDE_COLUMNS = 4;
export const TABLET_MIN_WIDTH = 768;
export const WIDE_MIN_WIDTH = 1180;

export function columnsForWidth(width: number): number {
  if (width >= WIDE_MIN_WIDTH) return WIDE_COLUMNS;
  if (width >= TABLET_MIN_WIDTH) return TABLET_COLUMNS;
  return PHONE_COLUMNS;
}

/** Usable width of one column once the gaps are removed. */
export function columnWidthFor(screenWidth: number, numColumns: number): number {
  return Math.floor((screenWidth - COLUMN_GAP * (numColumns + 1)) / numColumns);
}

/**
 * Shortest-first packing. Ties go to the leftmost column, so at numColumns === 2
 * this is identical to the original two-column implementation.
 */
export function packByHeight<T>(
  items: T[],
  heightOf: (item: T) => number,
  numColumns: number,
): { item: T; height: number }[][] {
  const cols: { item: T; height: number }[][] = Array.from(
    { length: numColumns },
    () => [],
  );
  const totals = new Array<number>(numColumns).fill(0);

  for (const item of items) {
    const height = heightOf(item);
    let target = 0;
    for (let i = 1; i < numColumns; i++) {
      if (totals[i] < totals[target]) target = i;
    }
    cols[target].push({ item, height });
    totals[target] += height + COLUMN_GAP;
  }

  return cols;
}
