/**
 * Masonry Layout Types
 *
 * Shared types for the true masonry grid system.
 */

/** Input item for masonry packing. */
export interface MasonryItem {
  /** Unique stable identifier (post ID). */
  id: string;
  /** Estimated height in pixels for this item at the target column width. */
  estimatedHeight: number;
}

/** A single column of packed items with tracked total height. */
export interface MasonryColumn<T extends MasonryItem = MasonryItem> {
  items: T[];
  totalHeight: number;
}

/** Result of a masonry packing operation. */
export interface MasonryPackResult<T extends MasonryItem = MasonryItem> {
  columns: MasonryColumn<T>[];
  /** Max column height (for scroll container sizing). */
  maxHeight: number;
}
