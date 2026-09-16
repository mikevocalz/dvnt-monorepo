import test from "node:test";
import assert from "node:assert/strict";
import {
  canOpenEventDirectly,
  filterDiscoverableEvents,
  isDiscoverableEvent,
  resolveEventBySlug,
  slugResolvesOnlyToHiddenEvent,
} from "./event-discovery.ts";

// The two live rows behind the bug: same title, one cancelled, one active.
const cancelled = { id: 79, title: 'DC "Dick-Strict"', status: "cancelled", created_at: "2026-08-01T00:00:00Z" };
const active = { id: 81, title: 'DC "Dick-Strict"', status: "active", created_at: "2026-09-01T00:00:00Z" };
const slug = "dc-dick-strict";

test("cancelled events are not discoverable, active ones are", () => {
  assert.equal(isDiscoverableEvent(cancelled), false);
  assert.equal(isDiscoverableEvent(active), true);
  // Legacy rows with no status stay visible — most of the table is NULL.
  assert.equal(isDiscoverableEvent({ id: 1, title: "x", status: null }), true);
  assert.deepEqual(
    filterDiscoverableEvents([cancelled, active]).map((e) => e.id),
    [81],
  );
});

test("public slug resolution never lands on a cancelled event", () => {
  assert.equal(resolveEventBySlug([cancelled, active], slug)?.id, 81);
  // Cancelled alone: the public URL resolves to nothing rather than to it.
  assert.equal(resolveEventBySlug([cancelled], slug), undefined);
});

test("two same-title live events resolve to the most recently created", () => {
  const older = { ...active, id: 81, created_at: "2026-09-01T00:00:00Z" };
  const newer = { ...active, id: 96, created_at: "2026-09-14T00:00:00Z" };
  assert.equal(resolveEventBySlug([older, newer], slug)?.id, 96);
  assert.equal(resolveEventBySlug([newer, older], slug)?.id, 96);
  // Without created_at the monotonic id is the tie-breaker.
  assert.equal(
    resolveEventBySlug(
      [
        { id: 81, title: active.title, status: "active" },
        { id: 96, title: active.title, status: "active" },
      ],
      slug,
    )?.id,
    96,
  );
});

test("a slug that only matches hidden events is cancelled, not missing", () => {
  assert.equal(slugResolvesOnlyToHiddenEvent([cancelled], slug), true);
  // A live event with the same title means the slug still resolves — not a dead end.
  assert.equal(slugResolvesOnlyToHiddenEvent([cancelled, active], slug), false);
  // A slug nothing matches is genuinely missing, and must not claim a cancellation.
  assert.equal(slugResolvesOnlyToHiddenEvent([cancelled], "nyc-freak-show"), false);
  assert.equal(slugResolvesOnlyToHiddenEvent([], slug), false);
});

test("a ticket holder, host or staff still opens a cancelled event directly", () => {
  assert.equal(canOpenEventDirectly(cancelled, { ticket: true }), true);
  assert.equal(canOpenEventDirectly(cancelled, { organizer: true }), true);
  assert.equal(canOpenEventDirectly(cancelled, { staff: true }), true);
  // Nobody in particular gets the discovery answer.
  assert.equal(canOpenEventDirectly(cancelled, {}), false);
  assert.equal(canOpenEventDirectly(active, {}), true);
});
