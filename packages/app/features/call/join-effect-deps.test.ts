/**
 * Guards the web join effects against the self-cancelling dependency trap.
 *
 * Both web room screens fetch a peer token in a `useEffect` that sets an
 * `initStarted` flag and cleans up with `cancelled = true`. Listing that flag
 * in the dependency array makes the effect depend on its own write: setting it
 * changes a dependency, so React runs the cleanup, the re-run hits the
 * early-return, and the in-flight join resolves into `if (cancelled) return`.
 * The join dies silently — no throw, no console error — and the call sits on
 * "Connecting…" at phase `joining_room` forever.
 *
 * That shipped to production and broke every web call. A source check is the
 * cheap way to keep it dead: the effect body is async and driven by the Fishjam
 * SDK, so reproducing it needs a full renderer plus a mocked WebRTC stack.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

const SCREENS = [
  "features/call/call.web.tsx",
  "features/video/video-room.web.tsx",
];

/** Dependency arrays: the `}, [ ... ]);` that closes a useEffect. */
function dependencyArrays(source: string): string[] {
  return [...source.matchAll(/\}\s*,\s*\[([^\]]*)\]\s*\)\s*;/g)].map(
    (m) => m[1],
  );
}

for (const rel of SCREENS) {
  test(`${rel}: no effect depends on the flag it sets`, () => {
    const source = readFileSync(join(ROOT, rel), "utf8");
    const offenders = dependencyArrays(source).filter((deps) =>
      /\binitStarted\b/.test(deps),
    );
    assert.deepEqual(
      offenders,
      [],
      `initStarted must not appear in a dependency array — it is written inside ` +
        `the join effect, so depending on it cancels the join mid-flight.`,
    );
  });

  test(`${rel}: initStarted is read from the store, not subscribed`, () => {
    const source = readFileSync(join(ROOT, rel), "utf8");
    // A `useXStore((s) => s.initStarted)` selector re-renders on the effect's
    // own write, which is what put the flag in the dependency array to begin
    // with. Reading it via getState() keeps the effect stable.
    assert.equal(
      /\(\s*\(?\s*s\s*\)?\s*=>\s*s\.initStarted\s*\)/.test(source),
      false,
      "subscribe to initStarted via getState() inside the effect instead",
    );
  });
}

test("the join effect still guards against double-joining", () => {
  // Dropping the dependency must not turn into dropping the guard: without it
  // a remount would mint a second peer token and join the room twice.
  for (const rel of SCREENS) {
    const source = readFileSync(join(ROOT, rel), "utf8");
    assert.match(
      source,
      /getState\(\)\.initStarted/,
      `${rel} lost its initStarted guard`,
    );
  }
});


test("rejoin is cancelled by room teardown, not by its own connecting status", () => {
  const source = readFileSync(join(ROOT, "features/call/call.web.tsx"), "utf8");
  const rejoin = source.slice(source.indexOf("// ── Auto-rejoin:"), source.indexOf("// ── Sync local camera stream"));
  assert.match(rejoin, /cancelRejoinRef\.current = \(\) =>/);
  assert.doesNotMatch(rejoin, /return \(\) =>/, "peerStatus cleanup must not self-cancel a successful reconnect");
  assert.ok((source.match(/cancelRejoinRef\.current\?\.\(\)/g) ?? []).length >= 3,
    "room change, leave and unmount all cancel in-flight recovery");
});
