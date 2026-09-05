import test from "node:test";
import assert from "node:assert/strict";
import { selectVenueForecast } from "../../../../apps/mobile/supabase/functions/_shared/venue-forecast";
const now = Date.parse("2026-09-05T12:00:00Z");
const hourly = { time:["2026-09-06T00:00", "2026-09-06T01:00"], temperature_2m:[20,25], weather_code:[0,61], precipitation_probability:[10,80] };
test("uses UTC doors hour, not the device date or current weather", () => {
  assert.deepEqual(selectVenueForecast({hourly}, "2026-09-05T21:00:00-04:00", now), {
    forecastAt:"2026-09-05T21:00:00-04:00", tempC:25,code:61,precipPct:80,
  });
});
test("missing forecast horizon, invalid temperatures and elapsed doors fail closed", () => {
  assert.equal(selectVenueForecast({hourly}, "2026-10-05T21:00:00Z", now), null);
  assert.equal(selectVenueForecast({hourly:{...hourly,temperature_2m:[null,null]}}, "2026-09-06T01:00:00Z", now), null);
  assert.equal(selectVenueForecast({hourly}, "2026-09-06T01:00:00Z", Date.parse("2026-09-07T00:00:00Z")), null);
});
