/**
 * node --test packages/app/features/sneaky-lynk/ui/hand-queue.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { buildHandQueue } from "./hand-queue.ts";

const dana = { userId: "u1", displayName: "Dana Reyes", username: "dana", avatar: "a.png" };
const anon = { userId: "u2", isAnonymous: true, anonLabel: null, displayName: "Sam Okafor" };

test("keeps raise order, oldest first, numbered from 1", () => {
  const q = buildHandQueue(["u2", "u1"], [dana, anon]);
  assert.deepEqual(
    q.map((e) => [e.position, e.userId]),
    [[1, "u2"], [2, "u1"]],
  );
});

test("an anonymous raiser never exposes a real name or avatar to the host", () => {
  const [entry] = buildHandQueue(["u2"], [anon]);
  assert.equal(entry.label, "Anonymous");
  assert.equal(entry.avatar, undefined, "an avatar would defeat the anonymity");
  assert.ok(!JSON.stringify(entry).includes("Sam"), "real name reached the entry");
});

test("someone who raised then left keeps their slot rather than renumbering the rest", () => {
  const q = buildHandQueue(["gone", "u1"], [dana]);
  assert.equal(q[0].departed, true);
  assert.equal(q[0].label, "Left the room");
  assert.equal(q[1].position, 2, "the waiting host must not see positions shuffle");
});

test("a duplicated id renders one row, so 'position 2 of 2' stays true", () => {
  const q = buildHandQueue(["u1", "u1"], [dana]);
  assert.equal(q.length, 1);
  assert.equal(q[0].position, 1);
});

test("an empty queue is empty, not a row of placeholders", () => {
  assert.deepEqual(buildHandQueue([], [dana]), []);
});

test("roster entries with no raised hand are not in the queue", () => {
  assert.deepEqual(buildHandQueue([], [dana, anon]), []);
  assert.equal(buildHandQueue(["u1"], [dana, anon]).length, 1);
});
