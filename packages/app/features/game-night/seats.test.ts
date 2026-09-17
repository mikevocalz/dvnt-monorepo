import test from "node:test";
import assert from "node:assert/strict";
import { seatsFor, isFull, entryMode, seatsLeft, MAX_PLAYERS } from "./seats.ts";

const p = (id: string) => ({ id, name: id, avatar: null });

test("a table always draws four seats, however few people are sitting", () => {
  assert.equal(seatsFor([], "h").length, MAX_PLAYERS);
  assert.equal(seatsFor([p("a")], "h").length, MAX_PLAYERS);
});

test("the host takes seat 0 so they do not move between rooms", () => {
  const seats = seatsFor([p("a"), p("host"), p("b")], "host");
  assert.equal(seats[0].player?.id, "host");
  assert.equal(seats[0].isHost, true);
});

test("empty seats are null rather than missing, so the row keeps its shape", () => {
  const seats = seatsFor([p("a")], "a");
  assert.equal(seats[1].player, null);
  assert.equal(seats[3].player, null);
});

test("a full table offers watching, not an error", () => {
  assert.equal(entryMode(4), "watch");
  assert.equal(entryMode(3), "play");
  assert.equal(isFull(4), true);
});

test("seats left never goes negative if a room somehow overfills", () => {
  assert.equal(seatsLeft(6), 0);
  assert.equal(seatsLeft(1), 3);
});
