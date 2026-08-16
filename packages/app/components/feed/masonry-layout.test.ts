/**
 * Masonry layout tests. Run with the repo's tsx (no new framework):
 *   node --import tsx --test packages/app/components/feed/masonry-layout.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  COLUMN_GAP,
  columnsForWidth,
  columnWidthFor,
  packByHeight,
} from "./masonry-layout";

test("columnsForWidth: phone stays two columns", () => {
  assert.equal(columnsForWidth(390), 2); // iPhone
  assert.equal(columnsForWidth(767), 2); // just under the tablet breakpoint
});

test("columnsForWidth: tablet widths add columns", () => {
  assert.equal(columnsForWidth(768), 3); // breakpoint is inclusive
  assert.equal(columnsForWidth(1024), 3); // iPad 12.9 portrait — the reported bug
  assert.equal(columnsForWidth(1180), 4);
  assert.equal(columnsForWidth(1366), 4); // iPad landscape
});

test("columnWidthFor: columns plus gaps never exceed the screen", () => {
  for (const width of [390, 768, 1024, 1180, 1366]) {
    const n = columnsForWidth(width);
    const col = columnWidthFor(width, n);
    assert.ok(col > 0, `column width must be positive at ${width}`);
    const used = col * n + COLUMN_GAP * (n + 1);
    assert.ok(
      used <= width,
      `columns overflow at ${width}: used ${used} > ${width}`,
    );
  }
});

test("packByHeight: every item is placed exactly once", () => {
  const items = Array.from({ length: 37 }, (_, i) => i);
  for (const n of [2, 3, 4]) {
    const cols = packByHeight(items, (i) => 100 + (i % 5) * 40, n);
    assert.equal(cols.length, n);
    const placed = cols.flat().map((c) => c.item).sort((a, b) => a - b);
    assert.deepEqual(placed, items, `lost or duplicated items at ${n} columns`);
  }
});

test("packByHeight: shortest-first keeps columns balanced", () => {
  const items = Array.from({ length: 60 }, (_, i) => i);
  const heightOf = (i: number) => 120 + ((i * 37) % 90);
  for (const n of [2, 3, 4]) {
    const cols = packByHeight(items, heightOf, n);
    const totals = cols.map((c) =>
      c.reduce((sum, x) => sum + x.height + COLUMN_GAP, 0),
    );
    const spread = Math.max(...totals) - Math.min(...totals);
    // One cell's worth of drift is inherent to greedy packing; more than that
    // means the shortest-first choice regressed.
    assert.ok(
      spread <= 210 + COLUMN_GAP,
      `columns unbalanced at ${n}: spread ${spread}`,
    );
  }
});

test("packByHeight: two columns still tie-break left, as before", () => {
  // Equal heights: strict `<` comparison must keep column 0 winning ties, which
  // is what the original h0 <= h1 implementation did.
  const cols = packByHeight([1, 2, 3, 4], () => 100, 2);
  assert.deepEqual(cols[0].map((c) => c.item), [1, 3]);
  assert.deepEqual(cols[1].map((c) => c.item), [2, 4]);
});
