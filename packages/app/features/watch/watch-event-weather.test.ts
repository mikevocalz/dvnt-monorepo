import test from "node:test";
import assert from "node:assert/strict";
import { createWatchVenueWeatherLoader } from "./watch-event-weather";
import type { WatchEvent } from "./watch-event-payload";
import type { LiveSurfacePayload } from "../live-surface/types";
const event: WatchEvent = { id:"1", title:"Published venue", startAt:"2026-09-06T20:00:00Z", latitude:40, longitude:-74, isOnline:false, status:"active", ticketingEnabled:false, saved:false, host:false, waitlist:[], canJoinWaitlist:false };
const payload = { generatedAt:"2026-09-05T12:00:00Z", weather:{tempF:74,label:"Clear",precipPct:10} } as LiveSurfacePayload;
const now = Date.parse("2026-09-05T12:00:00Z");
test("one venue request across concurrent loads and changed focus for 15 minutes", async () => {
  const calls: unknown[] = [];
  const load = createWatchVenueWeatherLoader(async (opts) => { calls.push(opts); return payload; });
  const result = await Promise.all([load([event],"A",()=>true,now), load([event],"A",()=>true,now)]);
  assert.equal(calls.length,1); assert.equal(result[0][0].weather?.tempF,74);
  const different = await load([{...event,id:"2",latitude:41}],"A",()=>true,now+60_000);
  assert.equal(calls.length,1); assert.equal(different[0].weather,undefined);
  await load([{...event,id:"2"}],"A",()=>true,now+15*60_000);
  assert.equal(calls.length,2);
});
test("no location access or request without eligible published venue coordinates", async () => {
  let calls = 0;
  const load = createWatchVenueWeatherLoader(async () => { calls++; return payload; });
  await load([{...event,latitude:undefined}],"A",()=>true,now);
  await load([{...event,isOnline:true}],"A",()=>true,now);
  await load([{...event,latitude:100}],"A",()=>true,now);
  assert.equal(calls,0);
});
test("account change during weather await suppresses result", async () => {
  let current = true;
  const load = createWatchVenueWeatherLoader(async () => { current=false; return payload; });
  const result = await load([event],"A",()=>current,now);
  assert.equal(result[0].weather,undefined);
});

test("doors timestamp crosses the transport unchanged and forecast labeling is preserved", async () => {
  let target: string | undefined;
  const load = createWatchVenueWeatherLoader(async (opts) => {
    target = opts.forecastAt;
    return {...payload, weather: {...payload.weather!, forecastAt: opts.forecastAt}};
  });
  const rows = await load([event], "A", () => true, now);
  assert.equal(target, event.startAt);
  assert.equal(rows[0].weather?.forecastAt, event.startAt);
});
