import assert from "node:assert/strict";
import test from "node:test";
import {
  classicWinText,
  duelFormatText,
  gameNightModeForPlayerCount,
} from "./game-rules.ts";

test("player count chooses the same mode as the server engine", () => {
  assert.equal(gameNightModeForPlayerCount(1), null);
  assert.equal(gameNightModeForPlayerCount(2), "duel");
  assert.equal(gameNightModeForPlayerCount(3), "classic");
  assert.equal(gameNightModeForPlayerCount(4), "classic");
  assert.equal(gameNightModeForPlayerCount(5), null);
});

test("rule summaries expose the actual win conditions", () => {
  assert.equal(classicWinText(5), "First player to 5 points wins the match.");
  assert.equal(
    duelFormatText(5),
    "Each player is the subject 5 times (10 rounds total). If the score is tied after that, rounds continue until the tie is broken.",
  );
});
