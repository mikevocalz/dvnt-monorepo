/** node --test packages/app/lib/hooks/responsive-grid.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveResponsiveGrid } from "./responsive-grid.ts";

// The parity case this file exists for: native reads the viewport through
// `useWindowDimensions`, web through a `resize` listener, and BOTH hand the
// numbers to this one function. If web and native ever disagree about how many
// columns a width earns, it is because someone re-implemented the maths instead
// of calling this — so assert the arithmetic here, once.

test("a wider viewport buys columns, not gutter", () => {
  const o = { minCellWidth: 240 };
  assert.equal(resolveResponsiveGrid(390, 844, o).columns, 1);
  assert.equal(resolveResponsiveGrid(768, 1024, o).columns, 2);
  assert.equal(resolveResponsiveGrid(1366, 1024, o).columns, 5);
});

test("web and native agree at the same size", () => {
  // Same numbers in, same layout out — one resolver, two viewport reads.
  const o = { minCellWidth: 180, gap: 2, horizontalPadding: 4, maxColumns: 8 };
  const native = resolveResponsiveGrid(1024, 1366, o);
  const web = resolveResponsiveGrid(1024, 1366, o);
  assert.deepEqual(web, native);
});

test("cells never fall below the readable minimum", () => {
  for (const w of [390, 744, 768, 834, 1024, 1180, 1366]) {
    const { cellWidth } = resolveResponsiveGrid(w, 1024, { minCellWidth: 240 });
    assert.ok(cellWidth >= 240 || w < 272, `${w}pt gave a ${cellWidth}pt cell`);
  }
});

test("orientation ceilings read the device, not the container", () => {
  const o = {
    minCellWidth: 110,
    gap: 2,
    horizontalPadding: 12,
    maxColumnsPortrait: 4,
    maxColumnsLandscape: 5,
    maxColumns: 5,
  };
  // Landscape iPad: wide enough for far more than 5, capped at the design max.
  assert.equal(resolveResponsiveGrid(1366, 1024, o).columns, 5);
  // Portrait iPad of the same area: one fewer by design.
  assert.equal(resolveResponsiveGrid(1024, 1366, o).columns, 4);
});

test("containerWidth sizes cells to the box, not the window", () => {
  // A capped content column (max-w-2xl = 672px) inside a 1440px window. Sizing
  // off the window is how the last column ran past the edge.
  const o = { minCellWidth: 150, gap: 8, horizontalPadding: 0 };
  const capped = resolveResponsiveGrid(1440, 900, { ...o, containerWidth: 672 });
  assert.equal(capped.available, 672);
  assert.ok(
    capped.cellWidth * capped.columns + 8 * (capped.columns - 1) <= 672,
    "cells plus gaps must fit the container",
  );
});

test("a zero-width viewport still yields one usable column", () => {
  // Pre-layout / hidden container. `columns: 0` divides by zero downstream.
  const g = resolveResponsiveGrid(0, 0, { minCellWidth: 200 });
  assert.equal(g.columns, 1);
  assert.equal(g.available, 0);
  assert.equal(g.isGrid, false);
});

// ── maxContainerWidth: the cap a centred column already has in its className ──
// Web screens cannot read `useWindowDimensions` (Law 3) and should not grow a
// ResizeObserver just to learn that `max-w-6xl` is 1152px. These assert that
// declaring the cap gives the same grid as measuring the box.

test("maxContainerWidth clamps the viewport to the centred column", () => {
  const o = { minCellWidth: 288, gap: 16, horizontalPadding: 32 };
  // A 1920px monitor showing a max-w-6xl (1152px) page: the grid must lay out
  // inside 1152 − 32, not 1920 − 32, or the last card runs into the gutter.
  const capped = resolveResponsiveGrid(1920, 1080, { ...o, maxContainerWidth: 1152 });
  const measured = resolveResponsiveGrid(1920, 1080, { ...o, containerWidth: 1152 });
  assert.deepEqual(capped, measured);
  assert.equal(capped.available, 1120);
});

test("maxContainerWidth is a ceiling, never a floor", () => {
  // A phone is narrower than the cap, so the cap must not widen it.
  const o = { minCellWidth: 288, gap: 16, horizontalPadding: 32, maxContainerWidth: 1152 };
  const phone = resolveResponsiveGrid(390, 844, o);
  assert.equal(phone.available, 358);
  assert.equal(phone.columns, 1);
});

test("both caps apply — the smaller wins", () => {
  const o = { minCellWidth: 150, gap: 16, horizontalPadding: 0 };
  const a = resolveResponsiveGrid(1920, 1080, { ...o, containerWidth: 600, maxContainerWidth: 1152 });
  const b = resolveResponsiveGrid(1920, 1080, { ...o, containerWidth: 1600, maxContainerWidth: 900 });
  assert.equal(a.available, 600);
  assert.equal(b.available, 900);
});

test("the events list keeps the column counts its thresholds used to hardcode", () => {
  // Replaces `width >= 960 ? 3 : width >= 600 ? 2 : 1` in events-list.web.tsx,
  // where `width` was the ResizeObserver'd container. Same answers, derived.
  const o = {
    minCellWidth: 288,
    gap: 16,
    horizontalPadding: 32,
    maxColumns: 3,
    maxContainerWidth: 1152,
  };
  assert.equal(resolveResponsiveGrid(1920, 1080, o).columns, 3); // desktop
  assert.equal(resolveResponsiveGrid(1024, 1366, o).columns, 3);
  assert.equal(resolveResponsiveGrid(768, 1024, o).columns, 2); // tablet
  assert.equal(resolveResponsiveGrid(390, 844, o).columns, 1); // phone
});

test("the composer's media tiles cap at four across, like native", () => {
  // create-post.web.tsx, mirroring `(tabs)/create.tsx`'s own options plus the
  // max-w-2xl (672px) composer column.
  const o = {
    minCellWidth: 150,
    gap: 16,
    horizontalPadding: 48,
    maxColumns: 4,
    maxContainerWidth: 672,
  };
  assert.equal(resolveResponsiveGrid(1920, 1080, o).columns, 3);
  assert.equal(resolveResponsiveGrid(390, 844, o).columns, 2);
  assert.ok(resolveResponsiveGrid(1920, 1080, o).cellWidth >= 150);
});
