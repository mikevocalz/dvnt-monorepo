/** node --test packages/app/lib/analytics/route-keys.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";

import { entityFromRoute, normalizeRoute } from "./route-keys.ts";

test("one row means one screen, not one url", () => {
  assert.equal(normalizeRoute("/feed/events/73"), "/feed/events/[id]");
  assert.equal(
    normalizeRoute("/events/avengers-endgame-watch-party"),
    "/events/[slug]",
  );
  assert.equal(
    normalizeRoute("/feed/sneaky-lynk/room/5a245913-0de3-48cc-bffd-0ecb88253b26"),
    "/feed/sneaky-lynk/room/[id]",
  );
  // Without this, "top pages" is a list of individual events, not pages.
  assert.equal(normalizeRoute("/feed/events/74"), normalizeRoute("/feed/events/73"));
});

test("which events get traffic is a group-by, not a regex at read time", () => {
  assert.deepEqual(entityFromRoute("/feed/events/73"), { type: "event", id: "73" });
  assert.deepEqual(entityFromRoute("/events/endgame-premiere"), {
    type: "event",
    id: "endgame-premiere",
  });
  assert.equal(
    entityFromRoute("/feed/sneaky-lynk/room/5a245913-0de3-48cc-bffd-0ecb88253b26")?.type,
    "lynk_room",
  );
});

test("a sub-route is not an entity", () => {
  // "/events/create" must not be recorded as traffic to an event called
  // "create" — that is how a top-events list gets a phantom winner.
  assert.equal(entityFromRoute("/feed/events/create"), null);
  assert.equal(entityFromRoute("/feed/events/host"), null);
  assert.equal(entityFromRoute("/feed"), null);
});
