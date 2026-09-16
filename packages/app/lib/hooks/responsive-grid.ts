/**
 * Column maths for every grid in the app — the pure half of
 * `use-responsive-grid`.
 *
 * It lives apart from the hook because the two platforms read the viewport with
 * different APIs (`useWindowDimensions` on native, a `resize` listener on web)
 * while the arithmetic that turns a width into columns is identical. Keeping it
 * here means there is ONE answer to "how many cells fit", it can be asserted
 * without a renderer, and the web build never has to import react-native to get
 * it.
 */

export interface ResponsiveGrid {
  /** How many cells fit across, at least 1. */
  columns: number;
  /** Width of one cell, gaps already removed. */
  cellWidth: number;
  /** The width the grid is laying out inside (viewport minus padding). */
  available: number;
  /** Convenience for `columns > 1`, which is usually what a container branches on. */
  isGrid: boolean;
}

export interface ResponsiveGridOptions {
  /** Smallest cell still worth showing. Columns fall out of this. */
  minCellWidth: number;
  gap?: number;
  horizontalPadding?: number;
  maxColumns?: number;
  /** Hard ceiling in portrait, when a surface has a designed maximum. */
  maxColumnsPortrait?: number;
  /** Hard ceiling in landscape. */
  maxColumnsLandscape?: number;
  /**
   * Width the grid actually lays out inside, when that is NOT the viewport.
   * A screen that caps its content column (max-w-3xl and friends) is the case
   * this exists for.
   */
  containerWidth?: number;
  /**
   * Ceiling on the layout width for a surface that CENTRES its content in a
   * capped column (`max-w-3xl`, `max-w-6xl`, …). Same intent as
   * `containerWidth`, but the caller does not have to measure: the grid clamps
   * the viewport itself, so a web screen needs neither a ResizeObserver nor
   * react-native's `useWindowDimensions` to get the box it is actually in.
   * Applied after `containerWidth`, so passing both takes the smaller.
   */
  maxContainerWidth?: number;
}

/**
 * @param viewportWidth  Width of the window/viewport, right now.
 * @param viewportHeight Height of the same, used only to decide orientation.
 */
export function resolveResponsiveGrid(
  viewportWidth: number,
  viewportHeight: number,
  {
    minCellWidth,
    gap = 12,
    horizontalPadding = 32,
    maxColumns = 6,
    maxColumnsPortrait,
    maxColumnsLandscape,
    containerWidth,
    maxContainerWidth,
  }: ResponsiveGridOptions,
): ResponsiveGrid {
  const width = Math.min(
    containerWidth ?? viewportWidth,
    maxContainerWidth ?? Number.POSITIVE_INFINITY,
  );
  // Orientation is a property of the DEVICE, not of the container, so it reads
  // the real viewport even when the grid is laying out inside a capped column.
  const orientationCap =
    viewportWidth > viewportHeight ? maxColumnsLandscape : maxColumnsPortrait;
  const available = Math.max(0, width - horizontalPadding);
  const ceiling = Math.min(maxColumns, orientationCap ?? maxColumns);
  const columns = Math.max(
    1,
    Math.min(ceiling, Math.floor((available + gap) / (minCellWidth + gap))),
  );
  const cellWidth = (available - gap * (columns - 1)) / columns;
  return { columns, cellWidth, available, isGrid: columns > 1 };
}
