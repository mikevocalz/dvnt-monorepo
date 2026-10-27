import test from "node:test";
import assert from "node:assert/strict";
import { formatEngagementCount, normalizeEngagementCount } from "./engagement-counts.ts";

test("visible totals are compact without rounding up or disappearing", () => {
  for (const [value, expected] of [[0,"0"],[1,"1"],[999,"999"],[1000,"1K"],[1250,"1.2K"],[999999,"999.9K"],[1000000,"1M"],[1234567,"1.2M"],[-1,"0"],[NaN,"0"],[Infinity,"0"]] as const) {
    assert.equal(formatEngagementCount(value), expected);
  }
});

test("normalization keeps valid totals and rejects invalid counts", () => {
  assert.equal(normalizeEngagementCount(12), 12);
  assert.equal(normalizeEngagementCount(1.9), 1);
  assert.equal(normalizeEngagementCount(-1), 0);
  assert.equal(normalizeEngagementCount(NaN), 0);
  assert.equal(normalizeEngagementCount(Infinity), 0);
});
