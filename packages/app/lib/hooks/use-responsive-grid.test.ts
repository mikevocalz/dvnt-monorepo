/** node --test packages/app/lib/hooks/use-responsive-grid.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";

/** Mirrors the hook's maths so it can be asserted without a renderer. */
function grid(width: number, minCellWidth: number, gap = 12, pad = 32, max = 6) {
  const available = Math.max(0, width - pad);
  const columns = Math.max(
    1,
    Math.min(max, Math.floor((available + gap) / (minCellWidth + gap))),
  );
  return { columns, cellWidth: (available - gap * (columns - 1)) / columns };
}

test("a bigger screen gets more content, not more gutter", () => {
  // The bug this replaces: 1366pt drew the same 2 columns as 768pt.
  const phone = grid(390, 240).columns;
  const portraitPad = grid(768, 240).columns;
  const landscapePad = grid(1366, 240).columns;
  assert.equal(phone, 1);
  assert.ok(portraitPad > phone, "a tablet should beat a phone");
  assert.ok(landscapePad > portraitPad, "landscape should beat portrait");
  assert.equal(landscapePad, 5);
});

test("cells never fall below the readable minimum", () => {
  for (const w of [390, 744, 768, 834, 1024, 1180, 1366]) {
    const { cellWidth } = grid(w, 240);
    assert.ok(cellWidth >= 240 || w < 240 + 32, `${w}pt gave a ${cellWidth}pt cell`);
  }
});

test("the grid always consumes its width", () => {
  // No dead space: columns * cell + gaps == available, to the pixel.
  for (const w of [390, 768, 1024, 1366]) {
    const { columns, cellWidth } = grid(w, 240);
    const used = columns * cellWidth + 12 * (columns - 1);
    assert.ok(Math.abs(used - (w - 32)) < 0.001, `${w}pt left ${w - 32 - used}pt unused`);
  }
});

test("a narrow window still renders one column rather than zero", () => {
  assert.equal(grid(200, 240).columns, 1);
  assert.equal(grid(0, 240).columns, 1);
});

test("a designed maximum wins over what merely fits", () => {
  // Explore: no more than 4 portrait / 5 landscape, however wide the tablet.
  const cap = (w: number, h: number) => {
    const available = Math.max(0, w - 12);
    const orientationCap = w > h ? 5 : 4;
    const ceiling = Math.min(5, orientationCap);
    return Math.max(1, Math.min(ceiling, Math.floor((available + 2) / (110 + 2))));
  };
  assert.equal(cap(768, 1024), 4, "portrait tablet caps at 4");
  assert.equal(cap(1366, 1024), 5, "landscape tablet caps at 5");
  assert.equal(cap(390, 844), 3, "a phone is limited by fit, not by the cap");
});
