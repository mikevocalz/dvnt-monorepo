import test from "node:test";
import assert from "node:assert/strict";
import { authoritativeDoor } from "./watch-door-payload";
const valid = { eventId:"1", eventTitle:"Door", expected:12, arrived:5, remaining:7, priorityLane:2, approaching:3 };
test("accepts only complete consistent aggregate counts and strips guest/location data", () => {
  assert.deepEqual(authoritativeDoor({...valid, latitude:40, guests:[{name:"Private"}]}),valid);
  for (const patch of [{expected:undefined},{arrived:-1},{remaining:8},{priorityLane:8},{approaching:8},{arrived:13},{expected:1.5}]) assert.equal(authoritativeDoor({...valid,...patch}),null);
});
