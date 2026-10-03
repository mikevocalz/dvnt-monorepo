import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  EVENT_LYNK_WAIT_POLL_MS,
  canHostEventLynk,
  roomInviteActivityText,
  waitingSinceLabel,
} from "./event-lynk.ts";

test("a Lynk invite tied to an event names the event", () => {
  assert.equal(roomInviteActivityText("Basement Set"), " invited you to Basement Set's Sneaky Lynk.");
});
test("an invite with no event, or a blank title, keeps the generic copy", () => {
  for (const title of [undefined, null, "", "   "])
    assert.equal(roomInviteActivityText(title), " invited you to a Sneaky Lynk.");
});
test("owners and accepted admin/editor co-organizers host; scanners and guests do not", () => {
  assert.deepEqual(
    (["owner", "admin", "editor", "scanner", null] as const).map(canHostEventLynk),
    [true, true, true, false, false],
  );
});
test("the client poll matches the server's heartbeat constant", () => {
  const src = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "apps", "mobile", "supabase", "functions", "event-lynk-room", "index.ts"),
    "utf8",
  );
  const m = src.match(/WAIT_HEARTBEAT_MS = ([\d_]+);/);
  assert.ok(m, "WAIT_HEARTBEAT_MS moved");
  assert.equal(Number(m[1].replace(/_/g, "")), EVENT_LYNK_WAIT_POLL_MS);
});
test("waiting time reads in minutes, then hours", () => {
  const now = Date.parse("2026-10-03T20:00:00Z");
  assert.equal(waitingSinceLabel("2026-10-03T19:59:30Z", now), "Just arrived");
  assert.equal(waitingSinceLabel("2026-10-03T19:57:00Z", now), "Waiting 3 min");
  assert.equal(waitingSinceLabel("2026-10-03T18:00:00Z", now), "Waiting 2 h");
  assert.equal(waitingSinceLabel("not a date", now), "Just arrived");
});
