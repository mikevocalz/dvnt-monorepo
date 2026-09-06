/**
 * An outgoing call has to RING the other side.
 *
 * Creating the room notifies nobody: the callee's device only reacts to a
 * `call_signals` INSERT, and `sendCallSignal` is what writes it. For months
 * that function had exactly one caller in the whole codebase — the native hook
 * `lib/hooks/use-video-call.ts` — so a call placed from the browser created a
 * room, joined it, and sat there alone while the other end never rang. The DB
 * showed it plainly: every signal was written by the iPad, and the web user's
 * last outgoing signal was three weeks stale.
 *
 * Source-level because the alternative is a renderer plus a mocked Fishjam and
 * Supabase stack to assert one INSERT.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dirname, "..", "..");

const read = (rel: string) => readFileSync(join(ROOT, rel), "utf8");

/** Every screen that can PLACE a call, and so must ring the callee. */
const OUTGOING_CALLERS = [
  "features/call/call.web.tsx",
  "lib/hooks/use-video-call.ts",
];

for (const rel of OUTGOING_CALLERS) {
  test(`${rel}: rings the callee when placing a call`, () => {
    assert.match(
      read(rel),
      /sendCallSignal\(/,
      `${rel} can start a call but never writes a call_signals row, so the ` +
        `callee's device stays silent`,
    );
  });
}

test("the web rings the room it actually created, not the URL's room id", () => {
  const source = read("features/call/call.web.tsx");
  const call = source.match(/sendCallSignal\(\{[\s\S]*?\}\)/);
  assert.ok(call, "no sendCallSignal call found");
  // Outgoing web calls mint a fresh room via call_create and join THAT id.
  // Ringing `roomId` would point the callee at the client-side placeholder
  // from the URL, which is not a real room — they would answer into nothing.
  assert.match(
    call[0],
    /roomId:\s*joinTargetId/,
    "ring the created room id (joinTargetId), not the URL roomId",
  );
});

test("the caller identity is read at send time, not captured", () => {
  // The auth store rehydrates on the tick this screen mounts, so a captured
  // `user` can still be null and would ring the callee from nobody.
  assert.match(
    read("features/call/call.web.tsx"),
    /useAuthStore\.getState\(\)\.user/,
    "read the caller from the store when sending, not from a captured value",
  );
});
