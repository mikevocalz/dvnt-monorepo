/**
 * Masonry Column Packer
 *
 * True shortest-column packing algorithm.
 * Places each item into the column with the current shortest total height.
 * No row locking. Variable heights fully supported.
 */
import type { MasonryItem, MasonryColumn, MasonryPackResult } from "./types";

/**
 * Pack items into columns using shortest-column-first placement.
 *
 * @param items - Array of items with estimated heights
 * @param columnCount - Number of columns (2 for phone, 3+ for tablet)
 * @returns Packed columns with items and total heights
 */
export function packColumns<T extends MasonryItem>(
  items: T[],
  columnCount: number,
): MasonryPackResult<T> {
  // Initialize empty columns
  const columns: MasonryColumn<T>[] = Array.from(
    { length: columnCount },
    () => ({ items: [], totalHeight: 0 }),
  );

  if (items.length === 0) {
    return { columns, maxHeight: 0 };
  }

  // Place each item in the shortest column
  for (const item of items) {
    let shortestIdx = 0;
    let shortestHeight = columns[0].totalHeight;

    for (let i = 1; i < columnCount; i++) {
      if (columns[i].totalHeight < shortestHeight) {
        shortestIdx = i;
        shortestHeight = columns[i].totalHeight;
      }
    }

    columns[shortestIdx].items.push(item);
    columns[shortestIdx].totalHeight += item.estimatedHeight;
  }

  const maxHeight = Math.max(...columns.map((c) => c.totalHeight));

  return { columns, maxHeight };
}
