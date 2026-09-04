/** node --test packages/app/features/sneaky-lynk/ui/stage-grid.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";

import { stageColumns, stageGridClass, stageMaxWidthStyle } from "./stage-grid.ts";

const PHONE = 390;
const LAPTOP = 1280;

test("nobody is enlarged just for being the host — tiles are uniform", () => {
  // The regression this file exists for: a 5-person room used to be 1 big + 4
  // small. Uniform means one class for the whole grid, so there is no "large".
  assert.equal(stageGridClass(5), "grid-cols-2 sm:grid-cols-3");
});

test("a wider viewport carries more columns at the same headcount", () => {
  for (const count of [2, 5, 12]) {
    assert.ok(
      stageColumns(count, LAPTOP) >= stageColumns(count, PHONE),
      `${count} people should not lose columns on a bigger screen`,
    );
  }
});

test("several guests stay on the stage rather than spilling to one column", () => {
  assert.equal(stageColumns(4, PHONE), 2);
  assert.equal(stageColumns(9, LAPTOP), 3);
  assert.equal(stageColumns(16, LAPTOP), 4);
});

test("the width cap tracks the grid's real aspect, not a fixed guess", () => {
  // 2 tiles in 2 cols is one wide row; 4 tiles in 2 cols is a square block.
  assert.match(stageMaxWidthStyle(2, 2), /\* 3\.5555/);
  assert.match(stageMaxWidthStyle(4, 2), /\* 1\.7777/);
});
