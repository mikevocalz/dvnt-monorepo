import test from "node:test";
import assert from "node:assert/strict";
import { activitySenderLabel, eventActivityRoute } from "./event-activity.ts";

const broadcast = {
  type: "event_broadcast", entityType: "event", entityId: "90",
  event: { id: "90" }, user: { username: "deviantevents", displayName: "Deviant Events" },
};

test("broadcast shows the resolved profile name, without relabeling ordinary users", () => {
  assert.equal(activitySenderLabel(broadcast), "Deviant Events");
  assert.equal(activitySenderLabel({ ...broadcast, user: { username: "anotherhost", displayName: "Another Host" } }), "Another Host");
  assert.equal(activitySenderLabel({ ...broadcast, type: "like" }), "deviantevents");
  assert.equal(activitySenderLabel({ ...broadcast, type: "message", user: { username: "alex", displayName: "Alex Smith" } }), "alex");
  assert.equal(activitySenderLabel({ ...broadcast, user: { username: "user" } }), "Event organizer");
});

test("numeric event notifications use ID detail routes on both platforms", () => {
  assert.equal(eventActivityRoute(broadcast, "web"), "/feed/events/90");
  assert.equal(eventActivityRoute(broadcast, "native"), "/(protected)/events/90");
  assert.equal(eventActivityRoute({ ...broadcast, entityType: undefined, entityId: undefined }, "native"), "/(protected)/events/90");
  assert.equal(eventActivityRoute({ ...broadcast, entityId: "91", event: { id: "90" } }, "web"), "/feed/events/91");
  assert.equal(eventActivityRoute({ type: "event_broadcast" }, "web"), "/feed/events");
  assert.equal(eventActivityRoute({ type: "follow", entityType: "user", entityId: "613" }, "web"), null);
});
