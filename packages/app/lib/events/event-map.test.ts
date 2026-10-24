import test from "node:test";
import assert from "node:assert/strict";
import { eventMapPins, eventMapIds, type EventMapLocation } from "./event-map.ts";

const now = Date.parse("2026-10-24T00:00:00Z");
const row: EventMapLocation = { id: 1, title: "Public venue", visibility: "public", is_hidden: false, publish_at: null, status: "active", is_online: false, location_type: "venue", location: "Published venue", location_name: null, location_lat: 0, location_lng: 0 };

test("public in-person events use saved coordinates, including zero", () => {
  assert.deepEqual(eventMapPins([row], ["1"], now), [{ id: "1", title: row.title, location: row.location, latitude: 0, longitude: 0 }]);
  assert.equal(eventMapPins([{ ...row, visibility: null, is_hidden: null, status: null, is_online: null, location_type: null }], ["1"], now).length, 1);
});
test("private, unpublished, hidden, online and incomplete policy payloads never become pins", () => {
  for (const patch of [
    { visibility: "private" }, { visibility: "link_only" }, { visibility: undefined },
    { is_hidden: true }, { is_hidden: undefined }, { publish_at: "2026-10-25" }, { publish_at: "invalid" }, { publish_at: undefined },
    { status: "unknown" }, { status: "draft" }, { status: "cancelled" }, { status: "suspended" }, { status: undefined },
    { is_online: true }, { is_online: undefined }, { location_type: "virtual" }, { location_type: undefined },
  ]) assert.deepEqual(eventMapPins([{ ...row, ...patch } as EventMapLocation], ["1"], now), [], JSON.stringify(patch));
});
test("removed IDs, removed coordinates, invalid numbers and out-of-range positions fail closed", () => {
  assert.deepEqual(eventMapPins([row], [], now), []);
  for (const coordinates of [
    { location_lat: null }, { location_lng: null }, { location_lat: NaN }, { location_lng: Infinity },
    { location_lat: 91 }, { location_lat: -91 }, { location_lng: 181 }, { location_lng: -181 },
  ]) assert.deepEqual(eventMapPins([{ ...row, ...coordinates }], ["1"], now), []);
});
test("same-title/same-location events keep their individual stable IDs; duplicate rows do not", () => {
  assert.deepEqual(eventMapPins([row, row, { ...row, id: 2 }], ["1", "2"], now).map((pin) => pin.id), ["1", "2"]);
});
test("map lookup accepts only bounded stable numeric IDs", () => {
  assert.deepEqual(eventMapIds(["1", "2", "1", "", "abc", "0", "-1", "1,2", "9007199254740992"]), ["1", "2"]);
});

test("existing Google embed protocol keeps valid zero coordinates and no user information", async () => {
  const { eventMapEmbedUrl, eventMapDirectionsUrl } = await import("./event-map.ts");
  const [pin] = eventMapPins([row], ["1"], now);
  assert.equal(eventMapEmbedUrl(pin), "https://maps.google.com/maps?q=0,0&z=15&output=embed");
  assert.equal(eventMapDirectionsUrl(pin), "https://maps.google.com/?q=0,0");
});

test("restrictive realtime list policies immediately revoke old map metadata", async () => {
  const { eventListAllowsMap } = await import("./event-map.ts");
  assert.equal(eventListAllowsMap({}, now), true);
  assert.equal([{publishAt: "2000-01-01"}].filter((event) => eventListAllowsMap(event, now)).length, 1);
  for (const patch of [{visibility:"private"}, {visibility:"link_only"}, {isHidden:true}, {isOnline:true}, {status:"draft"}, {status:"new-unknown-status"}, {publishAt:"invalid"}, {publishAt:"2099-01-01"}]) {
    assert.equal(eventListAllowsMap(patch, now), false, JSON.stringify(patch));
  }
});

test("realtime revocation removes coordinates before an in-flight request can finish", async () => {
  const { invalidateEventMapLocation } = await import("./event-map-cache.ts");
  const calls: string[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const client = {
    cancelQueries: (filter: {queryKey:string[];predicate:(query:{queryKey:unknown[]})=>boolean}, options: unknown) => { assert.deepEqual(filter.queryKey, ["events-map"]); assert.equal(filter.predicate({queryKey:["events-map", ["1"]]}), true); assert.equal(filter.predicate({queryKey:["events-map", ["2"]]}), false); assert.deepEqual(options, {revert:false}); calls.push("cancel"); return pending; },
    setQueriesData: (_filter: unknown, update: (rows: EventMapLocation[]) => EventMapLocation[]) => { assert.deepEqual(update([row]), []); calls.push("remove"); },
    invalidateQueries: () => { calls.push("refetch"); return Promise.resolve(); },
  };
  invalidateEventMapLocation(client as never, "1");
  assert.deepEqual(calls, ["cancel", "remove"]);
  release(); await pending; await Promise.resolve();
  assert.deepEqual(calls, ["cancel", "remove", "refetch"]);
});
