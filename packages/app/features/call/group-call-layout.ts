export interface GroupCallGridLayout {
  columns: number;
  rows: number;
  pageSize: number;
}

export interface GroupCallPage<T> extends GroupCallGridLayout {
  page: number;
  pageCount: number;
  visibleTiles: T[];
}

export function getGroupCallLayout(width: number, height: number): GroupCallGridLayout {
  if (width >= 1200) return { columns: 4, rows: 3, pageSize: 12 };
  if (Math.min(width, height) >= 600) return { columns: 3, rows: 3, pageSize: 9 };
  if (width > height) return { columns: 4, rows: 2, pageSize: 8 };
  return { columns: 2, rows: 3, pageSize: 6 };
}

export function clampGroupCallPage(page: number, tileCount: number, pageSize: number): number {
  const pageCount = Math.max(1, Math.ceil(tileCount / Math.max(1, pageSize)));
  return Math.min(Math.max(0, page), pageCount - 1);
}

export function moveGroupCallPage(page: number, delta: -1 | 1, pageCount: number): number {
  return Math.min(Math.max(0, page + delta), Math.max(0, pageCount - 1));
}

/**
 * The local tile is always first and always mounted, so your own preview never
 * lands on page two. The `isLocal: boolean` constraint is load-bearing: without
 * it TypeScript infers T from the remote literals and pins `isLocal` to the
 * literal `false`, which then rejects the local tile's `true`.
 */
export function orderGroupCallTiles<T extends { isLocal: boolean }>(
  localTile: T,
  remoteTiles: readonly T[],
): T[] {
  return [localTile, ...remoteTiles];
}

export function getGroupCallPage<T>(
  tiles: readonly T[],
  requestedPage: number,
  pageSize: number,
  layout?: Pick<GroupCallGridLayout, "columns" | "rows">,
): GroupCallPage<T> {
  const safePageSize = Math.max(1, pageSize);
  const pageCount = Math.max(1, Math.ceil(tiles.length / safePageSize));
  const page = clampGroupCallPage(requestedPage, tiles.length, safePageSize);
  return {
    columns: layout?.columns ?? safePageSize,
    rows: layout?.rows ?? 1,
    pageSize: safePageSize,
    page,
    pageCount,
    visibleTiles: tiles.slice(page * safePageSize, (page + 1) * safePageSize),
  };
}

/**
 * Tiles are never flatter than 16:9.
 *
 * A landscape phone is the case that breaks: 4 columns across 369pt of usable
 * width with only 88pt of usable height gives an 86x40 cell, flatter than 2:1,
 * and a face in it is a letterbox slit. When a cell is flatter than 16:9 the
 * tile keeps the cell's height and gives width back, so the row centres a set
 * of correctly proportioned tiles instead of stretching them. Cells that are
 * squarer or taller than 16:9, which is every phone portrait and tablet page,
 * are used as they are: phone video wants the height.
 */
export const MAX_TILE_ASPECT = 16 / 9;

export function getGroupCallTileSize(
  availableWidth: number,
  availableHeight: number,
  layout: Pick<GroupCallGridLayout, "columns" | "rows">,
  gap: number,
): { width: number; height: number } {
  const cellWidth = Math.max(
    1,
    (availableWidth - gap * (layout.columns - 1)) / layout.columns,
  );
  const cellHeight = Math.max(
    1,
    (availableHeight - gap * (layout.rows - 1)) / layout.rows,
  );
  if (cellWidth / cellHeight > MAX_TILE_ASPECT) {
    return { width: cellHeight * MAX_TILE_ASPECT, height: cellHeight };
  }
  return { width: cellWidth, height: cellHeight };
}

/**
 * Which page is someone speaking on, when it is not the page you are reading.
 *
 * Pagination buys legibility and costs awareness: the person talking can be on
 * a page you cannot see, and the call goes quiet-looking for no reason. This
 * returns the first page holding a speaker other than the current page, so the
 * pager can say so and offer to jump. Null means nothing to report.
 */
export function findSpeakingPage(
  tileIds: readonly string[],
  speakingIds: readonly string[],
  pageSize: number,
  currentPage: number,
): number | null {
  const speaking = new Set(speakingIds);
  const safePageSize = Math.max(1, pageSize);
  for (let index = 0; index < tileIds.length; index++) {
    const page = Math.floor(index / safePageSize);
    if (page !== currentPage && speaking.has(tileIds[index])) return page;
  }
  return null;
}
