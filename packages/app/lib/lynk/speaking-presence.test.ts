/**
 * node --test packages/app/lib/lynk/speaking-presence.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { applySpeakingEvent, type SpeakingMap } from "./speaking-presence.ts";

test("a remote speaking event lands in the map", () => {
  const next = applySpeakingEvent({}, { userId: "u1", speaking: true });
  assert.deepEqual(next, { u1: true });
});

test("our own broadcast is ignored — the local ring is computed, not received", () => {
  const prev: SpeakingMap = {};
  const next = applySpeakingEvent(prev, { userId: "me", speaking: true }, "me");
  assert.equal(next, prev, "same object, so no re-render");
});

test("an unchanged value returns the same object", () => {
  const prev: SpeakingMap = { u1: true };
  assert.equal(applySpeakingEvent(prev, { userId: "u1", speaking: true }), prev);
  const quiet: SpeakingMap = {};
  assert.equal(applySpeakingEvent(quiet, { userId: "u1", speaking: false }), quiet);
});

test("stopping deletes the key rather than storing false", () => {
  const next = applySpeakingEvent({ u1: true }, { userId: "u1", speaking: false });
  assert.deepEqual(next, {});
  assert.equal(Object.hasOwn(next, "u1"), false, "no permanent key per speaker");
});

test("an event with no user id is dropped", () => {
  const prev: SpeakingMap = { u1: true };
  assert.equal(applySpeakingEvent(prev, { userId: "", speaking: true }), prev);
});

test("several speakers coexist", () => {
  let m: SpeakingMap = {};
  m = applySpeakingEvent(m, { userId: "u1", speaking: true });
  m = applySpeakingEvent(m, { userId: "u2", speaking: true });
  m = applySpeakingEvent(m, { userId: "u1", speaking: false });
  assert.deepEqual(m, { u2: true });
});
