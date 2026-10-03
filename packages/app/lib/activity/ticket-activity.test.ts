/** node --test packages/app/lib/activity/ticket-activity.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isTicketActivityType, ticketActivityCopy } from "./ticket-activity.ts";

const NEW_TYPES = [
  "ticket_claim_required",
  "ticket_delivery_failed",
  "ticket_voided",
  "event_postponed",
  "event_time_changed",
  "event_venue_changed",
];

test("every type the taxonomy migration adds has row copy", () => {
  for (const type of NEW_TYPES) {
    assert.ok(ticketActivityCopy(type), `${type} has no copy`);
    assert.equal(isTicketActivityType(type), true);
  }
});

test("the migration adds exactly the types the copy table covers", () => {
  const sql = readFileSync(
    fileURLToPath(
      new URL(
        "../../../../apps/mobile/supabase/migrations/20261002173000_ticket_activity_taxonomy.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  const added = [...sql.matchAll(/ADD VALUE IF NOT EXISTS '([a-z_]+)'/g)].map((m) => m[1]);
  assert.deepEqual(added.sort(), [...NEW_TYPES].sort());
});

test("non-ticket types stay out of the Tickets tab", () => {
  assert.equal(isTicketActivityType("like"), false);
  assert.equal(isTicketActivityType(undefined), false);
});

// The web and native Activity screens each keep their own row-text switch.
// A screen that imports the helper but never calls it renders a bare
// username for these rows (native did exactly that), so both are checked.
for (const screen of [
  "../../features/activity/activity.web.tsx",
  "../../features/routes/screens/(protected)/(tabs)/activity.tsx",
]) {
  test(`${screen} renders copy and counts the Tickets tab`, () => {
    const source = readFileSync(fileURLToPath(new URL(screen, import.meta.url)), "utf8");
    assert.match(source, /return ticketActivityCopy\(activity\.type\)/);
    for (const type of NEW_TYPES) {
      assert.ok(source.includes(`case "${type}":`), `${type} missing from ${screen}`);
    }
    assert.match(source, /Tickets: activities\.filter\(/);
  });
}
