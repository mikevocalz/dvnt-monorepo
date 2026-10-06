const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const edge = fs.readFileSync(
  path.join(__dirname, "../functions/event-analytics/index.ts"),
  "utf8",
);
const web = fs.readFileSync(
  path.join(__dirname, "../../../../packages/app/features/events/analytics.web.tsx"),
  "utf8",
);
const native = fs.readFileSync(
  path.join(__dirname, "../../../../packages/app/features/routes/screens/(protected)/events/[id]/analytics.tsx"),
  "utf8",
);

assert.match(edge, /attendanceBreakdown/);
assert.match(edge, /rsvp:\s*rsvpCount/);
assert.match(edge, /paid:\s*paidTicketCount/);
assert.match(edge, /total:\s*validTickets\.length \+ rsvpOnlyCount/);
assert.match(edge, /purchase_amount_cents/);

for (const ui of [web, native]) {
  assert.match(ui, /attendanceBreakdown\.rsvp/);
  assert.match(ui, /attendanceBreakdown\.paid/);
  assert.match(ui, /attendanceBreakdown\.total/);
}

// This test intentionally targets host analytics files only. Public event
// surfaces continue to consume the single maintained total_attendees value.
console.log("host attendance breakdown source contract: ok");
