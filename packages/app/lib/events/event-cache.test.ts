import test from "node:test";
import assert from "node:assert/strict";
import { removeEventFromData } from "./event-cache.ts";

test("deleted event disappears from lists, infinite pages, search and ticket embeds", () => {
  const event = { id: 42, title: "DC", location: "DC", fullDate: "2026-10-01" };
  const other = { ...event, id: 43 };
  const data = { pages: [{ events: [event, other] }], event, items: [event] };
  assert.deepEqual(removeEventFromData(data, "42"), { pages: [{ events: [other] }], event: null, items: [] });
  assert.equal(data.event, event, "does not mutate previous cache snapshot");
});
test("post and profile with colliding numeric IDs survive", () => {
  const data = { posts: [{ id: "42", content: "hello", author: { id: "42" } }], users: [{ id: 42 }] };
  assert.equal(removeEventFromData(data, "42"), data);
});
test("event domain handles sparse rows and mixed numeric/string IDs", () => {
  assert.deepEqual(removeEventFromData([{ id: 42 }, { id: "43" }], "42", true), [{ id: "43" }]);
});
test("spotlight campaigns remove their deleted event without matching the campaign ID", () => {
  const campaign = { campaign_id: 7, event_id: 42, title: "DC", location: "DC", start_date: "2026-10-01" };
  assert.deepEqual(removeEventFromData([campaign], "42"), []);
  assert.equal(removeEventFromData(campaign, "7"), campaign);
});
