/**
 * Edit-field registry tests (prompt Phase 5.5.1). Run:
 *   node --import tsx --test packages/app/lib/contracts/event-edit-fields.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { EVENT_EDIT_FIELDS, uncoveredEditFields, fieldKey } from "./event-edit-fields";

test("registry has unique (table, field) keys — no dupes", () => {
  const keys = EVENT_EDIT_FIELDS.map(fieldKey);
  assert.equal(new Set(keys).size, keys.length);
});

test("registry covers every table the edit form must hydrate", () => {
  const tables = new Set(EVENT_EDIT_FIELDS.map((f) => f.table));
  for (const t of ["events", "flyer", "ticket_types", "ticket_addons", "ticket_addon_variants", "event_spotlight_campaigns"]) {
    assert.ok(tables.has(t as any), `missing table coverage: ${t}`);
  }
});

test("capacity + boost fields carry their server-side edit guard", () => {
  const cap = EVENT_EDIT_FIELDS.find((f) => f.table === "ticket_types" && f.field === "quantity_total");
  assert.match(cap!.edit_guard ?? "", /capacity_below_sold/);
  const evCap = EVENT_EDIT_FIELDS.find((f) => f.table === "events" && f.field === "max_attendees");
  assert.match(evCap!.edit_guard ?? "", /capacity_below_sold/);
  const boost = EVENT_EDIT_FIELDS.find((f) => f.table === "event_spotlight_campaigns" && f.field === "status");
  assert.match(boost!.edit_guard ?? "", /guard_boost_event_eligible/);
});

test("uncoveredEditFields flags fields a form forgot to render", () => {
  const all = new Set(EVENT_EDIT_FIELDS.map(fieldKey));
  assert.equal(uncoveredEditFields(all).length, 0); // full coverage → none

  const partial = new Set([...all].filter((k) => k !== "ticket_types.price_schedule"));
  const missing = uncoveredEditFields(partial);
  assert.equal(missing.length, 1);
  assert.equal(fieldKey(missing[0]), "ticket_types.price_schedule");
});

test("cancel cascade + refund-window propagation present on the right fields", () => {
  const status = EVENT_EDIT_FIELDS.find((f) => f.table === "events" && f.field === "status");
  assert.equal(status!.propagation, "cancel_cascade");
  const date = EVENT_EDIT_FIELDS.find((f) => f.table === "events" && f.field === "date");
  assert.equal(date!.propagation, "notify_refund_window");
});
