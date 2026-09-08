import test from "node:test";
import assert from "node:assert/strict";
import { packMasonry, tileBounds, type PackTile } from "./masonry-pack.ts";

type P = { id: string; h: number };
type E = { id: string };

const COLUMN_WIDTH = 300;
const GAP = 10;
const EVENT_ASPECT = 1.6;

const opts = {
  postHeight: (p: P) => p.h,
  eventHeight: (w: number) => Math.round(w / EVENT_ASPECT) + 24,
  columnWidth: COLUMN_WIDTH,
  gap: GAP,
};

/** Posts of deliberately uneven heights, so the columns cannot stay level. */
function tiles(postHeights: number[], eventAfter: number[]): PackTile<P, E>[] {
  const out: PackTile<P, E>[] = [];
  postHeights.forEach((h, i) => {
    out.push({ kind: "post", key: `p${i}`, post: { id: `p${i}`, h } });
    if (eventAfter.includes(i)) {
      out.push({ kind: "event", key: `e${i}`, event: { id: `e${i}` } });
    }
  });
  return out;
}

/**
 * The regression this module exists for: a two-column event card painted over a
 * post in the neighbouring column.
 */
function overlaps(result: ReturnType<typeof packMasonry<P, E>>): string[] {
  const bounds = tileBounds(result, opts);
  const clashes: string[] = [];
  for (const a of bounds) {
    for (const b of bounds) {
      if (a.key === b.key) continue;
      const aCols = new Set(Array.from({ length: a.span }, (_, i) => a.column + i));
      const bCols = new Set(Array.from({ length: b.span }, (_, i) => b.column + i));
      const shareColumn = [...aCols].some((c) => bCols.has(c));
      if (!shareColumn) continue;
      const vertical = a.top < b.bottom && b.top < a.bottom;
      if (vertical) clashes.push(`${a.key} over ${b.key}`);
    }
  }
  return clashes;
}

test("a spanning event card never overlaps a post in the neighbouring column", () => {
  // Wildly uneven heights are the case that used to break: the packer computed
  // a levelled `top` and then placed the card at its own column's bottom.
  const heights = [900, 120, 140, 1100, 130, 150, 160, 170, 900, 110, 120, 130, 140, 150];
  for (const numColumns of [2, 3, 4]) {
    const result = packMasonry({
      tiles: tiles(heights, [6, 13]),
      numColumns,
      ...opts,
    });
    assert.deepEqual(
      overlaps(result),
      [],
      `overlap at ${numColumns} columns`,
    );
  }
});

test("the card and its reserved space start at the same y in both columns", () => {
  const result = packMasonry({
    tiles: tiles([800, 100, 100, 100, 100, 100, 100], [6]),
    numColumns: 2,
    ...opts,
  });
  const bounds = tileBounds(result, opts);
  const card = bounds.find((b) => b.key === "e6");
  assert.ok(card, "card was placed");
  // Nothing in either column it covers may occupy the same vertical band.
  for (const b of bounds) {
    if (b.key === card.key) continue;
    const covered = b.column === card.column || b.column === card.column + 1;
    if (!covered) continue;
    assert.equal(
      b.top < card.bottom && card.top < b.bottom,
      false,
      `${b.key} sits inside the card's band`,
    );
  }
});

test("no post is dropped or duplicated", () => {
  const heights = Array.from({ length: 40 }, (_, i) => 100 + ((i * 37) % 400));
  const result = packMasonry({
    tiles: tiles(heights, [6, 13, 20, 27, 34]),
    numColumns: 4,
    ...opts,
  });
  const placed = result.columns
    .flat()
    .filter((t) => t.kind === "post")
    .map((t) => (t as { post: P }).post.id);
  assert.equal(placed.length, 40);
  assert.equal(new Set(placed).size, 40);
});

test("every event is placed exactly once", () => {
  const result = packMasonry({
    tiles: tiles(Array.from({ length: 30 }, () => 200), [6, 13, 20]),
    numColumns: 3,
    ...opts,
  });
  const events = result.columns
    .flat()
    .filter((t) => t.kind === "event")
    .map((t) => t.key);
  assert.deepEqual(events.sort(), ["e13", "e20", "e6"]);
});

test("a single column places the event inline instead of spanning", () => {
  const result = packMasonry({
    tiles: tiles([100, 100, 100, 100, 100, 100, 100], [6]),
    numColumns: 1,
    ...opts,
  });
  const card = result.columns[0].find((t) => t.kind === "event");
  assert.equal(card?.kind === "event" && card.span, undefined, "no span at 1 column");
  assert.deepEqual(overlaps(result), []);
});

test("levelling never reorders the tiles already in a column", () => {
  const result = packMasonry({
    tiles: tiles([600, 100, 100, 100, 100, 100, 100, 100], [6]),
    numColumns: 2,
    ...opts,
  });
  for (const col of result.columns) {
    const posts = col.filter((t) => t.kind === "post").map((t) => t.key);
    const sorted = [...posts].sort(
      (a, b) => Number(a.slice(1)) - Number(b.slice(1)),
    );
    assert.deepEqual(posts, sorted, "posts kept their feed order in-column");
  }
});
