import test from "node:test";
import assert from "node:assert/strict";
import {
  generateRoomCode,
  normalizeRoomCode,
  isCompleteRoomCode,
  ROOM_CODE_LENGTH,
} from "./room-code.ts";

test("a generated code is the advertised length", () => {
  assert.equal(generateRoomCode().length, ROOM_CODE_LENGTH);
});

test("generated codes never contain the characters people mishear", () => {
  const banned = /[OI015S]/;
  for (let i = 0; i < 500; i++) {
    assert.ok(!banned.test(generateRoomCode()), "code contained a lookalike");
  }
});

test("a pasted code survives lowercase, spaces and stray punctuation", () => {
  assert.equal(normalizeRoomCode(" a b-c 2 3 4 "), "ABC234");
});

test("normalizing never returns more than a whole code", () => {
  assert.equal(normalizeRoomCode("ABC234EXTRA").length, ROOM_CODE_LENGTH);
});

test("a code missing a character is not complete", () => {
  assert.equal(isCompleteRoomCode("ABC23"), false);
  assert.equal(isCompleteRoomCode("ABC234"), true);
});
