const { test } = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const tracker = readFileSync(
  resolve(__dirname, "../docs/release/dvnt-65-closeout-2026-10-16.md"),
  "utf8",
);
const rows = Array.from(tracker.matchAll(
  /^\| \*\*([A-Z][0-9]{2})\*\* \| (MERGED CODE|PARTIAL|OPEN|SUPERSEDED) \|/gm,
)).map(match => ({ id: match[1], status: match[2] }));

test("all 65 original requirements have exactly one status", () => {
  assert.equal(rows.length, 65);
  assert.equal(new Set(rows.map(row => row.id)).size, 65);
  // Count-only checks can silently accept a typo such as P13 replacing P12.
  const expectedIds = Object.entries({ A: 6, P: 12, E: 10, T: 10, S: 12, R: 7, W: 1, C: 4, D: 3 })
    .flatMap(([prefix, count]) => Array.from({ length: count }, (_, i) => `${prefix}${String(i + 1).padStart(2, "0")}`));
  assert.deepEqual(rows.map(row => row.id).sort(), expectedIds.sort());
  const counts = Object.fromEntries(["MERGED CODE","PARTIAL","OPEN","SUPERSEDED"]
    .map(status => [status,rows.filter(row=>row.status===status).length]));
  assert.deepEqual(counts, {
    "MERGED CODE": 26,
    "PARTIAL": 31,
    "OPEN": 5,
    "SUPERSEDED": 3,
  });
});

test("original open/superseded blockers cannot disappear without evidence", () => {
  const status = Object.fromEntries(rows.map(row=>[row.id,row.status]));
  for (const id of ["A06","S09","S12","C03","D01"]) assert.equal(status[id],"OPEN",id);
  for (const id of ["A04","T05","R07"]) assert.equal(status[id],"SUPERSEDED",id);
  for (const id of ["S06","S07","C01","C02","C04","D02"]) assert.equal(status[id],"PARTIAL",id);
});

test("merged PR references never masquerade as successful production acceptance", () => {
  assert.match(tracker, /#94/);
  assert.match(tracker, /#121/);
  assert.match(tracker, /verified_admission_policy\.enforce = false/);
  assert.match(tracker, /1,933 DMs queued/);
  assert.match(tracker, /deployed `video_join_room` source still contains/);
  assert.match(tracker, /No merge or production mutation is authorized/);
});

test("latest reconciliation separates fresh observations from historical evidence", () => {
  assert.match(tracker, /refreshed October 19, 2026/);
  assert.match(tracker, /Historical October 16 deployment snapshot/);
  assert.match(tracker, /Observed October 19, 2026 at 17:22 UTC/);
  assert.match(tracker, /1,946 queued DMs/);
  assert.match(tracker, /26 MERGED CODE \/ 31 PARTIAL \/ 5 OPEN \/ 3 SUPERSEDED/);
  assert.match(tracker, /open and unmerged/);
  assert.match(tracker, /Security\/incident review for #135 is not signed off/);
  for (const pr of [123,124,125,126,127,128,129,130,131,132,133,134,135]) {
    assert.ok(tracker.includes(`https://github.com/mikevocalz/dvnt-monorepo/pull/${pr}`), `Missing PR #${pr}`);
  }
});
