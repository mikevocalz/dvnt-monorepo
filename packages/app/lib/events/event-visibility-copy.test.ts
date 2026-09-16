import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  EVENT_VISIBILITY_COPY,
  EVENT_VISIBILITY_OPTIONS,
  eventVisibilityCopy,
  resolveEventVisibility,
} from "./event-visibility-copy.ts";

const VALUES = ["public", "link_only", "private"] as const;

test("every visibility value has a label, summary, and helper", () => {
  for (const v of VALUES) {
    const copy = EVENT_VISIBILITY_COPY[v];
    assert.equal(copy.value, v);
    for (const field of ["label", "summary", "helper"] as const) {
      assert.equal(typeof copy[field], "string", `${v}.${field} missing`);
      assert.ok(copy[field].length > 0, `${v}.${field} empty`);
    }
  }
  // Picker order runs open -> closed and covers every value exactly once.
  assert.deepEqual(
    EVENT_VISIBILITY_OPTIONS.map((o) => o.value),
    ["public", "link_only", "private"],
  );
});

test("legacy 'unlisted' resolves to the link_only copy", () => {
  assert.equal(resolveEventVisibility("unlisted"), "link_only");
  assert.equal(eventVisibilityCopy("unlisted"), EVENT_VISIBILITY_COPY.link_only);
  // Unknown and missing values fall back to public, same as the API reader.
  assert.equal(resolveEventVisibility(undefined), "public");
  assert.equal(resolveEventVisibility("bogus"), "public");

  // Drift guard: the API reader must keep folding "unlisted" into link_only.
  const here = dirname(fileURLToPath(import.meta.url));
  const api = readFileSync(join(here, "..", "api", "events.ts"), "utf8");
  assert.match(api, /value === "unlisted"\)?\s*return "link_only"/);
});

test("no copy string promises a guest list or invite-only access", () => {
  const banned = /guest list|guestlist|invite[- ]only|invitation/i;
  for (const v of VALUES) {
    const copy = EVENT_VISIBILITY_COPY[v];
    for (const field of ["label", "summary", "helper"] as const) {
      assert.doesNotMatch(copy[field], banned, `${v}.${field} oversells access`);
    }
  }
});

test("link_only says plainly that a forwarded link still works", () => {
  const { helper } = EVENT_VISIBILITY_COPY.link_only;
  assert.match(helper, /forward/i);
  assert.match(helper, /not listed/i);
});

test("private describes the access mechanism that actually exists", () => {
  const { helper } = EVENT_VISIBILITY_COPY.private;
  assert.match(helper, /comp/i);
  assert.match(helper, /co-organizer/i);
});
