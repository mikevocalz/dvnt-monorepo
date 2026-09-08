/**
 * Column packing for the web feed masonry.
 *
 * Extracted from `features/home/screen.web.tsx` so the rule can be tested. The
 * packer decides column placement up front in plain JS, which only works while
 * every tile's rendered height matches the height the packer reserved for it.
 * When they disagree the columns drift, and a card that spans two of them lands
 * on top of a post.
 */

/** One event card every N posts — imported by callers from `feed-sections`. */
export interface PackTile<Post, Event> {
  kind: "post" | "event";
  key: string;
  post?: Post;
  event?: Event;
}

export type PackedTile<Post, Event> =
  | { kind: "post"; key: string; post: Post }
  | { kind: "event"; key: string; event: Event; span?: 2 }
  /** Reserved vertical space. Either levelling, or the room a span occupies. */
  | { kind: "spacer"; key: string; height: number };

export interface PackInput<Post, Event> {
  tiles: readonly PackTile<Post, Event>[];
  numColumns: number;
  /** Rendered height of a post tile, gap excluded. */
  postHeight: (post: Post) => number;
  /** Rendered height of an event card at the given pixel width, gap excluded. */
  eventHeight: (width: number) => number;
  columnWidth: number;
  gap: number;
}

export interface PackResult<Post, Event> {
  columns: PackedTile<Post, Event>[][];
  /** Final height of each column, for assertions and debugging. */
  heights: number[];
}

export function packMasonry<Post, Event>(
  input: PackInput<Post, Event>,
): PackResult<Post, Event> {
  const { tiles, numColumns, postHeight, eventHeight, columnWidth, gap } = input;
  const n = Math.max(1, numColumns);

  const cols = Array.from({ length: n }, () => ({
    items: [] as PackedTile<Post, Event>[],
    h: 0,
  }));

  const spanWidth = columnWidth * 2 + gap;
  const canSpan = n >= 2;

  for (const tile of tiles) {
    if (tile.kind === "event" && tile.event !== undefined && canSpan) {
      // Cheapest adjacent pair, so the banner never straddles a tall column.
      let pair = 0;
      for (let c = 1; c <= n - 2; c++) {
        if (
          Math.max(cols[c].h, cols[c + 1].h) <
          Math.max(cols[pair].h, cols[pair + 1].h)
        ) {
          pair = c;
        }
      }

      const top = Math.max(cols[pair].h, cols[pair + 1].h);

      /**
       * Level BOTH columns to `top` before placing the card.
       *
       * This is what was missing. `top` was computed and then never applied, so
       * the card went into its column at that column's own content bottom. When
       * that column was the shorter of the pair, a card two columns wide began
       * ABOVE the neighbour's content and was painted straight over it.
       */
      if (cols[pair].h < top) {
        cols[pair].items.push({
          kind: "spacer",
          key: `${tile.key}-level-a`,
          height: top - cols[pair].h,
        });
        cols[pair].h = top;
      }
      if (cols[pair + 1].h < top) {
        cols[pair + 1].items.push({
          kind: "spacer",
          key: `${tile.key}-level-b`,
          height: top - cols[pair + 1].h,
        });
        cols[pair + 1].h = top;
      }

      const h = eventHeight(spanWidth) + gap;
      cols[pair].items.push({
        kind: "event",
        key: tile.key,
        event: tile.event,
        span: 2,
      });
      cols[pair + 1].items.push({
        kind: "spacer",
        key: `${tile.key}-spacer`,
        height: h,
      });
      cols[pair].h = top + h;
      cols[pair + 1].h = top + h;
      continue;
    }

    let min = 0;
    for (let c = 1; c < n; c++) {
      if (cols[c].h < cols[min].h) min = c;
    }

    if (tile.kind === "event" && tile.event !== undefined) {
      cols[min].items.push({ kind: "event", key: tile.key, event: tile.event });
      cols[min].h += eventHeight(columnWidth) + gap;
    } else if (tile.post !== undefined) {
      cols[min].items.push({ kind: "post", key: tile.key, post: tile.post });
      cols[min].h += postHeight(tile.post) + gap;
    }
  }

  return { columns: cols.map((c) => c.items), heights: cols.map((c) => c.h) };
}

/**
 * Every tile's vertical extent in its column, for overlap assertions.
 * A spanning event occupies its own column AND the next one.
 */
export function tileBounds<Post, Event>(
  result: PackResult<Post, Event>,
  opts: { postHeight: (post: Post) => number; eventHeight: (width: number) => number; columnWidth: number; gap: number },
): { column: number; span: number; key: string; top: number; bottom: number }[] {
  const out: { column: number; span: number; key: string; top: number; bottom: number }[] = [];
  const spanWidth = opts.columnWidth * 2 + opts.gap;
  result.columns.forEach((items, column) => {
    let y = 0;
    for (const item of items) {
      const height =
        item.kind === "spacer"
          ? item.height
          : item.kind === "event"
            ? opts.eventHeight(item.span === 2 ? spanWidth : opts.columnWidth) + opts.gap
            : opts.postHeight(item.post) + opts.gap;
      if (item.kind !== "spacer") {
        out.push({
          column,
          span: item.kind === "event" && item.span === 2 ? 2 : 1,
          key: item.key,
          top: y,
          bottom: y + height,
        });
      }
      y += height;
    }
  });
  return out;
}
