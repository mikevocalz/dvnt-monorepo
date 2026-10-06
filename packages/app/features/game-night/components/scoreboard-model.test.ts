import assert from "node:assert/strict";
import test from "node:test";
import { rankScores, scoreProgress } from "./scoreboard-model.ts";

test("score progress clamps to a usable HUD percentage", () => {
  assert.equal(scoreProgress(5, 10), 50);
  assert.equal(scoreProgress(12, 10), 100);
  assert.equal(scoreProgress(-2, 10), 0);
  assert.equal(scoreProgress(2, 0), 0);
});

test("score ranking preserves ties and deterministic input order", () => {
  const rows = rankScores(
    [
      { value: "a", userId: "a", score: 8 },
      { value: "b", userId: "b", score: 5 },
      { value: "c", userId: "c", score: 5 },
      { value: "d", userId: "d", score: 1 },
    ],
    10,
  );

  assert.deepEqual(
    rows.map(({ userId, rank, isLeader }) => ({ userId, rank, isLeader })),
    [
      { userId: "a", rank: 1, isLeader: true },
      { userId: "b", rank: 2, isLeader: false },
      { userId: "c", rank: 2, isLeader: false },
      { userId: "d", rank: 4, isLeader: false },
    ],
  );
});
