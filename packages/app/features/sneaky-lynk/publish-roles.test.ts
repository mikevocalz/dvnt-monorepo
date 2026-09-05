/** node --test packages/app/features/sneaky-lynk/publish-roles.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isPublisherRole } from "./publish-roles.ts";

test("every joiner can publish — a Lynk is a room, not a broadcast", () => {
  // `participant` is what video_join_room assigns. Excluding it was the bug.
  assert.equal(isPublisherRole("participant"), true);
  for (const r of ["host", "co-host", "speaker"]) assert.equal(isPublisherRole(r), true);
});

test("a role nobody granted cannot publish", () => {
  for (const r of ["listener", "viewer", "banned", "", null, undefined]) {
    assert.equal(isPublisherRole(r as any), false);
  }
});
