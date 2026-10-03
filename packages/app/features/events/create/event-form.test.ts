/**
 * The publish payload carries a duplicated draft's zone. Without it,
 * eventsApi.createEvent fills in the publisher's device zone, so a Los Angeles
 * event duplicated from New York was stored as New York.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buildEventInsert, type EventFormDraft } from "./event-form.ts";

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

test("a fresh draft sends no zone, so createEvent uses the device zone", () => {
  assert.equal(buildEventInsert(draft({ eventTz: null })).eventTz, undefined);
  assert.equal(buildEventInsert(draft()).eventTz, undefined);
  assert.equal(buildEventInsert(draft({ eventTz: "  " })).eventTz, undefined);
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
