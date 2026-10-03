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

test("every Lynk path that hosts, joins or re-mints a token runs verified admission", () => {
  const fnDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "apps", "mobile", "supabase", "functions");
  for (const fn of ["video_create_room", "video_join_room", "video_refresh_token", "lynk-moq-token", "lynk-livestream-token"]) {
    const src = readFileSync(join(fnDir, fn, "index.ts"), "utf8");
    const call = src.indexOf("resolveVerifiedAdmission(supabase, userId)");
    assert.ok(call > 0, `${fn} never calls resolveVerifiedAdmission`);
    assert.match(src.slice(call, call + 400), /admission\.state === "blocked"[\s\S]*?admissionRefusal\(admission\)/, `${fn} does not refuse a blocked verdict`);
  }
});
