import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { eventLocationUpdate } from "./event-location-update.ts";

const original = { location: "BJ Roosters", location_name: "BJ Roosters", location_address: "Old street", location_lat: 33.8, location_lng: -84.3 };
test("web venue edit replaces old name/address/pin in the persisted row", () => {
  const row = { ...original, ...eventLocationUpdate({ location: " Underground Atlanta " }, original.location) };
  assert.deepEqual(row, { location: "Underground Atlanta", location_name: null, location_address: null, location_lat: null, location_lng: null });
  // The detail screen's fallback now resolves the new location for its map.
  assert.equal(row.location_name || row.location, "Underground Atlanta");
  assert.equal(row.location_address || row.location, "Underground Atlanta");
});
test("title-only and unchanged venue saves preserve selected place metadata", () => {
  assert.deepEqual(eventLocationUpdate({}, original.location), {});
  assert.deepEqual({ ...original, ...eventLocationUpdate({location: "BJ Roosters"}, original.location) }, original);
});
test("clearing a venue clears all stale map data", () => {
  assert.deepEqual(eventLocationUpdate({location: ""}, original.location), {location: "", location_name: null, location_address: null, location_lat: null, location_lng: null});
});
test("structured location callers can atomically replace all data, including zero coordinates", () => {
  assert.deepEqual(eventLocationUpdate({ location: "New", locationName: "New venue", locationAddress: "New street", locationLat: 0, locationLng: 0 }, original.location), {location: "New", location_name: "New venue", location_address: "New street", location_lat: 0, location_lng: 0});
});
test("coordinate-only callers and address updates remain supported", () => {
  assert.deepEqual(eventLocationUpdate({locationLat: 1, locationLng: 2}, original.location), {location_lat: 1, location_lng: 2});
  assert.deepEqual(eventLocationUpdate({locationAddress: "New street"}, original.location), {location_address: "New street"});
});
test("API uses the location patch and exposes the persisted address when reopening details", () => {
  const source = readFileSync(new URL("../api/events.ts", import.meta.url), "utf8");
  assert.match(source, /Object\.assign\(updateData, eventLocationUpdate\(updates, beforeEvent\?\.location\)\)/);
  assert.match(source, /locationAddress: ev\.location_address \|\| ev\.location \|\| undefined/);
});

test("successful save replaces both camelCase and snake_case cache metadata", async () => {
  const { stripTypeScriptTypes } = await import("node:module");
  const { runInNewContext } = await import("node:vm");
  const hooks = readFileSync(new URL("../hooks/use-events.ts", import.meta.url), "utf8");
  const body = hooks.slice(hooks.indexOf("function buildEventCachePatch("), hooks.indexOf("export function useUpdateEvent("));
  const buildPatch = runInNewContext(stripTypeScriptTypes(body) + ";buildEventCachePatch", {
    isSensitiveAttendanceEvent: () => false,
  });
  const patch = buildPatch({location: "Underground Atlanta", locationName: null, locationAddress: null, locationLat: null, locationLng: null});
  const cached = {locationName: "BJ Roosters", locationAddress: "Old street", locationLat: 33.8, locationLng: -84.3, ...patch};
  assert.equal(cached.locationName, null);
  assert.equal(cached.location_name, null);
  assert.equal(cached.locationAddress, "Underground Atlanta");
  assert.equal(cached.location_address, null);
  assert.equal(cached.locationLat, null);
  assert.equal(cached.locationLng, null);
  assert.match(hooks, /locationAddress: r\.location_address/);
});

test("real updateEvent save persists and returns a coherent location patch", async () => {
  const { stripTypeScriptTypes } = await import("node:module");
  const { runInNewContext } = await import("node:vm");
  const source = readFileSync(new URL("../api/events.ts", import.meta.url), "utf8");
  const start = source.indexOf("  async updateEvent(");
  const end = source.indexOf("\n  /**\n   * Delete event", start);
  const method = source.slice(start, end)
    .replace('await import("../auth/supabase-jwt")', '({ensureSupabaseJwt: async () => true})')
    .replaceAll('await import("./invoke-edge")', '({invokeEdge: async () => {}})');
  let row: Record<string, unknown> = {...original, id: 42};
  const supabase = {from: () => {
    let patch: Record<string, unknown> | undefined;
    const query = {
      select: () => query, eq: () => query,
      maybeSingle: async () => ({data: {...row}, error: null}),
      update: (value: Record<string, unknown>) => {patch=value; return query;},
      setHeader: async () => {row = {...row,...patch};return {data:[row],error:null};},
    };
    return query;
  }};
  const api = runInNewContext(stripTypeScriptTypes(`({${method}})`), {
    getSessionLifecycle: () => ({epoch: 1, ready:true}), getCurrentUserAuthId: async () => "owner",
    getAuthIdFromStore: () => "owner", supabase,
    DB:{events:{table:"events",id:"id",title:"title",description:"description",location:"location",startDate:"start_date"}},
    eventLocationUpdate, getBridgeRequestEpoch: () => 1, endsBeforeStart: () => false, publishAtError: () => null, console,
  });
  api.canEditEvent = async () => true;
  const saved = await api.updateEvent("42", {location:"Underground Atlanta"});
  assert.equal(saved.location, "Underground Atlanta");
  for(const key of ["location_name","location_address","location_lat","location_lng"]) assert.equal(saved[key],null);
  await api.updateEvent("42", {description:"New description"});
  assert.equal(row.location,"Underground Atlanta");
});
