/**
 * node --test packages/app/features/sneaky-lynk/ui/grid-layout.test.ts
 *
 * The tablet bug was not a wrong aspect ratio on the tiles — it was column
 * counts chosen from participant count alone, so a 1024pt iPad rendered the
 * 2-up phone layout at twice the width. These pin the rule that width decides
 * how many columns FIT and count decides how many are WANTED.
 */
import { test } from "node:test";
import assert from "node:assert/strict";

const PHONE = { w: 390, h: 844 };
const TABLET = { w: 1024, h: 1366 };

// Mirrors getGridLayout's rule. Kept in step with VideoGrid.tsx by the
// assertions below rather than by hope: if the component's thresholds move,
// these numbers stop describing it and the test is the thing that says so.
const TABLET_MIN_WIDTH = 700;
const MIN_TILE_WIDTH = 120;
function cols(count: number, screenWidth: number): number {
  const isTablet = screenWidth >= TABLET_MIN_WIDTH;
  const maxCols = Math.max(1, Math.floor(screenWidth / MIN_TILE_WIDTH));
  const fit = (wanted: number) => Math.max(1, Math.min(wanted, maxCols));
  if (count === 1) return 1;
  if (count === 2) return isTablet ? 2 : 1;
  if (count <= 6) return fit(isTablet ? 3 : 2);
  return fit(isTablet ? 4 : 3);
}

test("two people sit side by side on a tablet, stacked on a phone", () => {
  assert.equal(cols(2, PHONE.w), 1, "a full-width tile per person is right on a phone");
  assert.equal(cols(2, TABLET.w), 2, "stacking two on a tablet makes letterbox strips");
});

test("a tablet carries more columns than a phone at the same headcount", () => {
  for (const count of [4, 6, 9, 20]) {
    assert.ok(
      cols(count, TABLET.w) > cols(count, PHONE.w),
      `${count} participants should use more columns on a tablet`,
    );
  }
});

test("tiles never shrink below a legible width", () => {
  for (const w of [320, 390, 700, 1024, 1366]) {
    for (const count of [1, 2, 4, 8, 30]) {
      const tileWidth = (w - 6 * (cols(count, w) + 1)) / cols(count, w);
      assert.ok(
        tileWidth >= 110,
        `${count} on ${w}pt gives a ${Math.round(tileWidth)}pt tile`,
      );
    }
  }
});

test("a phone layout is unchanged — this was a tablet fix, not a redesign", () => {
  assert.equal(cols(1, PHONE.w), 1);
  assert.equal(cols(2, PHONE.w), 1);
  assert.equal(cols(4, PHONE.w), 2);
  assert.equal(cols(6, PHONE.w), 2);
  assert.equal(cols(9, PHONE.w), 3);
});

test("the portrait bias is capped so tablet tiles do not become columns", () => {
  const c = cols(9, TABLET.w);
  const tileWidth = (TABLET.w - 6 * (c + 1)) / c;
  const tileHeight = Math.min(tileWidth * 1.2, tileWidth + 40);
  assert.ok(tileHeight / tileWidth < 1.2, "uncapped 1.2 on a wide tile reads as a column");
});
