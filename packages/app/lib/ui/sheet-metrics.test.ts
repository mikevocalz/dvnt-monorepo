/** node --test packages/app/lib/ui/sheet-metrics.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";

const MAX_SHEET_WIDTH = 768;
const SHEET_BOTTOM_INSET = 46;

/** Mirrors `detachedSheetMetrics` — same approach as `use-responsive-grid.test`. */
function metrics(windowWidth: number, windowHeight: number) {
  const width = Math.min(windowWidth - 48, MAX_SHEET_WIDTH);
  const height = Math.min(
    width * (4 / 3),
    windowHeight * 0.92 - SHEET_BOTTOM_INSET,
  );
  return { width, height, marginHorizontal: (windowWidth - width) / 2 };
}

test("phones keep the docs' 24pt gutter", () => {
  for (const [w, h] of [
    [390, 844],
    [430, 932],
    [768, 1024], // exactly max-w-3xl is still under the cap once gutters apply
  ]) {
    assert.equal(metrics(w, h).marginHorizontal, 24, `${w}x${h}`);
  }
});

test("tablets cap at max-w-3xl and centre", () => {
  const ipad = metrics(1024, 1366);
  assert.equal(ipad.width, MAX_SHEET_WIDTH);
  assert.equal(ipad.marginHorizontal, (1024 - 768) / 2);
});

test("3:4 portrait — taller than wide", () => {
  const ipad = metrics(1024, 1366);
  assert.ok(ipad.height > ipad.width, "sheet must be portrait");
  assert.equal(ipad.height, 768 * (4 / 3));
});

test("always clears the detached inset", () => {
  for (const [w, h] of [
    [390, 844],
    [1024, 1366],
    [1366, 1024],
    [1194, 834], // short landscape: a true 3:4 box would overflow
  ]) {
    const m = metrics(w, h);
    assert.ok(
      m.height + SHEET_BOTTOM_INSET <= h,
      `${w}x${h}: ${m.height} + inset overflows`,
    );
  }
});

test("the clamp actually engages on a short landscape iPad", () => {
  const short = metrics(1194, 834);
  assert.ok(short.height < short.width * (4 / 3), "expected clamp, not 3:4");
});
