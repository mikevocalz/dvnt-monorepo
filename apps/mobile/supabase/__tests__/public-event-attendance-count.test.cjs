const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const source = fs.readFileSync(
  path.join(__dirname, "../migrations/20261006225000_public_event_people_going.sql"),
  "utf8",
);

// Regression: guest tickets (NULL user_id) must count, so never return to
// COUNT(DISTINCT tickets.user_id) for the public attendance total.
assert.match(source, /count\(\*\)::integer AS n[\s\S]*FROM public\.tickets/);
assert.doesNotMatch(source, /count\(DISTINCT\s+t\.user_id\)/i);

// Checked-in attendees remain "going"; refunds/voids do not.
assert.match(source, /'active', 'scanned', 'transfer_pending'/);

// RSVP is additive only when that member does not already hold a valid ticket.
assert.match(source, /rsvp_only/);
assert.match(source, /NOT EXISTS[\s\S]*FROM public\.tickets/);

// Deploy repairs historical stale counters immediately.
assert.match(source, /UPDATE public\.events e[\s\S]*event_people_going_count\(e\.id\)/);

console.log("public event attendance counter source contract: ok");
