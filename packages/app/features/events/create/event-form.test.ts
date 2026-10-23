/**
 * The publish payload carries a duplicated draft's zone. Without it,
 * eventsApi.createEvent fills in the publisher's device zone, so a Los Angeles
 * event duplicated from New York was stored as New York.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildEventInsert, type EventFormDraft } from "./event-form.ts";
import { deviceTimeZone } from "../../../lib/events/event-zone.ts";

const draft = (over: Partial<EventFormDraft> = {}): EventFormDraft => ({
  title: "Cookout (Copy)",
  description: "",
  eventDate: "2026-11-01T01:00:00.000Z",
  endDate: null,
  location: "Echo Park",
  locationData: null,
  isOnline: false,
  eventType: null,
  tags: [],
  visibility: "public",
  ageRestriction: "none",
  isNsfw: false,
  dressCode: "",
  doorPolicy: "",
  lineup: [],
  perks: [],
  disclaimers: "",
  youtubeUrl: "",
  attachLynkRoom: false,
  ticketingEnabled: false,
  ticketPrice: "",
  maxAttendees: "",
  ticketTiers: [],
  agreementAccepted: true,
  ...over,
});

test("a duplicated draft publishes in its source event's zone", () => {
  assert.equal(buildEventInsert(draft({ eventTz: "America/Los_Angeles" })).eventTz, "America/Los_Angeles");
});

// The timezone branch made the zone part of every insert: the wall clock is
// read in it, so a draft with no usable zone publishes in the device's zone.
test("a draft with no usable zone publishes in the device zone", () => {
  const device = deviceTimeZone();
  assert.equal(buildEventInsert(draft({ eventTz: null })).eventTz, device);
  assert.equal(buildEventInsert(draft()).eventTz, device);
  assert.equal(buildEventInsert(draft({ eventTz: "  " })).eventTz, device);
});

test("promo code templates read as plain discounts, enabled first", async () => {
  const { describePromoTemplate, sortPromoTemplates } = await import("./event-form.ts");
  const base = { ticketTierName: null, active: true };
  assert.equal(describePromoTemplate({ ...base, code: "A", discountType: "percent", discountValue: 10 }), "10% off");
  assert.equal(describePromoTemplate({ ...base, code: "B", discountType: "fixed_cents", discountValue: 500 }), "$5.00 off");
  assert.equal(
    describePromoTemplate({ ...base, code: "C", discountType: "bogo", discountValue: 0, ticketTierName: "VIP" }),
    "Buy one, get one, VIP only",
  );
  const sorted = sortPromoTemplates([
    { ...base, code: "OLD", discountType: "percent", discountValue: 5, active: false },
    { ...base, code: "SAVE", discountType: "percent", discountValue: 10 },
  ]);
  assert.deepEqual(sorted.map((p) => p.code), ["SAVE", "OLD"]);
});

test("Event Type reaches the server independently of secondary tags", () => {
  const payload = buildEventInsert(draft({ eventType: "game_night", tags: ["music"] }));
  assert.equal(payload.category, "game_night");
  assert.equal(payload.event_type, "game_night");
});


test("protected event publish payloads default attendee profiles off", () => {
  for (const eventType of ["sex_party", "virtual_session", "party"] as const) {
    for (const attachLynkRoom of [false, true]) {
      assert.equal(buildEventInsert(draft({ eventType, attachLynkRoom })).showAttendees, false);
      assert.equal(buildEventInsert(draft({ eventType, attachLynkRoom, showAttendees: null })).showAttendees, false);
      assert.equal(buildEventInsert(draft({ eventType, attachLynkRoom, showAttendees: false })).showAttendees, false);
      assert.equal(buildEventInsert(draft({ eventType, attachLynkRoom, showAttendees: true })).showAttendees, true);
    }
  }
});

test("attendee visibility accepts only literal boolean true", () => {
  for (const showAttendees of ["true", 1, {}, []]) {
    assert.equal(buildEventInsert(draft({ eventType: "sex_party", showAttendees: showAttendees as unknown as boolean })).showAttendees, false);
  }
});
