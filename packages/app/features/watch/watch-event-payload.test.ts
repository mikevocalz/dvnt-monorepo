import test from "node:test";
import assert from "node:assert/strict";
import { buildWatchEvents, validateEventCommand, type WatchEventRelations, type WatchEventRow } from "./watch-event-payload";
const now = Date.parse("2026-09-05T20:00:00Z");
const row: WatchEventRow = { id: 1, title: "Tonight", start_date: "2026-09-05T22:00:00Z", end_date: "2026-09-06T05:00:00Z", event_tz: "America/New_York", status: "active", ticketing_enabled: false };
const relations: WatchEventRelations = { authId: "auth", rsvps: [], invitations: [], likes: [], waitlist: [], tiers: [] };
test("an invitation without a ticket is a real event with canonical venue time", () => {
  const event = buildWatchEvents([row], { ...relations, invitations: [{ event_id: 1, status: "pending" }] }, now)[0];
  assert.equal(event.inviteStatus, "pending");
  assert.equal(event.startAt, "2026-09-05T22:00:00.000Z");
  assert.equal(event.endAt, "2026-09-06T05:00:00.000Z");
  assert.equal(event.timeZone, "America/New_York");
  assert.equal(event.rsvp, undefined);
  assert.equal(event.ticketingEnabled, false);
});
test("waitlist admission uses active public tiers; unlimited and future tiers are not falsely sold out", () => {
  const sold = { event_id: 1, quantity_total: 4, quantity_sold: 4, tier_visibility: "public" };
  assert.equal(buildWatchEvents([row], { ...relations, tiers: [sold] }, now)[0].canJoinWaitlist, true);
  for (const tier of [{ ...sold, quantity_total: null }, { ...sold, quantity_sold: 3 }, { ...sold, tier_visibility: "hidden" }, { ...sold, sale_start: "2026-10-01T00:00:00Z" }]) {
    assert.equal(buildWatchEvents([row], { ...relations, tiers: [tier] }, now)[0].canJoinWaitlist, false);
  }
  assert.equal(buildWatchEvents([{ ...row, status: "cancelled" }], { ...relations, tiers: [sold] }, now)[0].canJoinWaitlist, false);
});
test("saved, RSVP and offer state stay distinct; media uses a bounded rendition", () => {
  const event = buildWatchEvents([{ ...row, flyer_image_url: "https://dvnt.b-cdn.net/flyer.jpg" }], { ...relations,
    rsvps: [{ event_id: 1, status: "interested" }], likes: [{ event_id: 1 }],
    waitlist: [{ event_id: 1, offer_status: "offered", offer_expires_at: "2026-09-05T23:00:00Z" }],
  }, now)[0];
  assert.equal(event.saved, true); assert.equal(event.rsvp, "interested");
  assert.equal(event.waitlist[0].offerStatus, "offered");
  assert.equal(event.waitlist[0].offerExpiresAt, "2026-09-05T23:00:00.000Z");
  assert.match(event.imageURL!, /width=320/);
  assert.equal(buildWatchEvents([{ ...row, flyer_image_url: "file:///private/image.jpg" }], relations, now)[0].imageURL, undefined);
});
test("event actions reject stale, foreign, malformed and unbounded commands", () => {
  const command = { protocol: 2, accountGen: "account", operationId: "a20f6049-ab0f-49d2-8621-232571c4eed9", type: "eventAction", eventId: "1", action: "going", issuedAt: 100, expiresAt: 130 };
  assert.equal(validateEventCommand(command, "account", 110)?.action, "going");
  for (const patch of [{ accountGen: "old" }, { issuedAt: 116 }, { expiresAt: 110 }, { expiresAt: 131 }, { eventId: "1,2" }, { operationId: "" }, { action: "admit" }, { expiresAt: Infinity }]) {
    assert.equal(validateEventCommand({ ...command, ...patch }, "account", 110), null);
  }
});
