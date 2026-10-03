/** node --test packages/app/lib/activity/ticket-activity.test.ts */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isTicketActivityType, ticketActivityCopy } from "./ticket-activity.ts";

const HERE = dirname(fileURLToPath(import.meta.url));

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
    resolve(
      HERE,
      "../../../../apps/mobile/supabase/migrations/20261002173000_ticket_activity_taxonomy.sql",
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
    const source = readFileSync(resolve(HERE, screen), "utf8");
    assert.match(source, /return ticketActivityCopy\(activity\.type\)/);
    for (const type of NEW_TYPES) {
      assert.ok(source.includes(`case "${type}":`), `${type} missing from ${screen}`);
    }
    assert.match(source, /Tickets: activities\.filter\(/);
  });
}

// T04: ticket notifications open the pass or the claim screen, not the event.
import { ticketActivityRoute } from "./ticket-activity.ts";

const TICKET_UUID = "0b3f8c1e-6a2d-4c55-9e1f-2d7a9b6c4e10";

test("comp, refund, void and delivery rows open the viewer's pass for the event", () => {
  for (const type of ["ticket_comped", "ticket_refunded", "ticket_voided", "ticket_delivery_failed"]) {
    const row = { type, entityType: "event", entityId: "4821" };
    assert.equal(ticketActivityRoute(row, "native"), "/(protected)/ticket/4821");
    assert.equal(ticketActivityRoute(row, "web"), "/feed/ticket/4821");
  }
});

test("a ticket id in the payload opens that exact pass", () => {
  const row = { type: "ticket_comped", entityType: "event", entityId: "4821", payload: { ticket_id: TICKET_UUID } };
  assert.equal(ticketActivityRoute(row, "native"), `/(protected)/ticket/${TICKET_UUID}`);
  assert.equal(ticketActivityRoute(row, "web"), `/feed/ticket/${TICKET_UUID}`);
  // A payload id that is not a uuid is ignored, never interpolated.
  assert.equal(
    ticketActivityRoute({ ...row, payload: { ticket_id: "../admin" } }, "web"),
    "/feed/ticket/4821",
  );
});

test("transfers and claims open My Tickets, where they are accepted", () => {
  for (const type of [
    "ticket_transfer_initiated",
    "ticket_transfer_accepted",
    "ticket_transfer_declined",
    "ticket_transfer_cancelled",
    "ticket_claim_required",
  ]) {
    const row = { type, entityType: "ticket_transfer", entityId: "991" };
    assert.equal(ticketActivityRoute(row, "native"), "/(protected)/events/my-tickets");
    assert.equal(ticketActivityRoute(row, "web"), "/feed/events/my-tickets");
  }
});

test("a pass row with no usable id falls back to My Tickets, not an event page", () => {
  assert.equal(ticketActivityRoute({ type: "ticket_refunded" }, "web"), "/feed/events/my-tickets");
  assert.equal(
    ticketActivityRoute({ type: "ticket_refunded", entityType: "event", entityId: "abc" }, "native"),
    "/(protected)/events/my-tickets",
  );
});

test("other types keep their existing routing", () => {
  for (const type of ["event_cancelled", "event_postponed", "event_venue_changed", "like", "event_promoter_added"]) {
    assert.equal(ticketActivityRoute({ type, entityType: "event", entityId: "4821" }, "web"), null);
  }
});
