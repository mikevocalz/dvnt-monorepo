/**
 * The remembered-role rules, which decide who a door lets in with no signal.
 *
 * Worth testing rather than eyeballing: the failure mode is not a broken
 * screen, it is a phone that admits people it should not, or refuses staff it
 * should not — and neither shows up until the venue's signal drops.
 */

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import {
  rememberDoorRole,
  recallDoorRole,
  forgetDoorRole,
} from "./confirmed-door-role.ts";

/** Minimal localStorage: the module only uses getItem/setItem. */
function installStorage() {
  const map = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    localStorage: {
      getItem: (k: string) => map.get(k) ?? null,
      setItem: (k: string, v: string) => void map.set(k, v),
    },
  };
  return map;
}

const DAY = 24 * 60 * 60 * 1000;

beforeEach(() => {
  installStorage();
});

test("a device that was never confirmed does not get in", () => {
  assert.equal(recallDoorRole("event-1"), null);
});

test("a confirmed role is remembered for that event only", () => {
  rememberDoorRole("event-1", "scanner");
  assert.equal(recallDoorRole("event-1"), "scanner");
  // Staffing one door is not staffing every door.
  assert.equal(recallDoorRole("event-2"), null);
});

test("a remembered role expires, so last month's door is not tonight's", () => {
  const t0 = Date.now();
  rememberDoorRole("event-1", "scanner");
  assert.equal(recallDoorRole("event-1", t0 + DAY - 1000), "scanner");
  assert.equal(recallDoorRole("event-1", t0 + DAY + 1000), null);
});

test("forgetting is immediate — a removed staffer loses offline entry", () => {
  rememberDoorRole("event-1", "scanner");
  forgetDoorRole("event-1");
  assert.equal(recallDoorRole("event-1"), null);
});

test("corrupt storage reads as 'never confirmed', never as authorised", () => {
  const map = installStorage();
  map.set("dvnt.door.confirmed-role.v1", "{not json");
  assert.equal(recallDoorRole("event-1"), null);
});

test("an empty event id or role is not stored", () => {
  rememberDoorRole("", "scanner");
  rememberDoorRole("event-1", "");
  assert.equal(recallDoorRole(""), null);
  assert.equal(recallDoorRole("event-1"), null);
});
