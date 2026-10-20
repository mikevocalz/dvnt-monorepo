/** node --test packages/app/features/sneaky-lynk/ui/stage-grid.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";

import { stageColumns, stageGridClass } from "./stage-grid.ts";

const PHONE = 390;
const LAPTOP = 1280;

test("fallback multi-person grids keep responsive columns", () => {
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

test("solo, one-to-one, and group calls have explicit modes", async () => {
  const { stageMode } = await import("./stage-grid.ts");
  assert.equal(stageMode(0), "solo");
  assert.equal(stageMode(1), "solo");
  assert.equal(stageMode(2), "duo");
  for (const count of [3, 4, 6, 12]) assert.equal(stageMode(count), "group");
});

test("two-person web rooms stack on desktop as well as phones", () => {
  assert.equal(stageGridClass(1), "grid-cols-1");
  assert.equal(stageGridClass(2), "grid-cols-1");
  assert.equal(stageColumns(2, PHONE), 1);
  assert.equal(stageColumns(2, LAPTOP), 1);
});
