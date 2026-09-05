/** Select a UTC hour near published doors; never substitute current weather. */
export function selectVenueForecast(data: { hourly?: { time?: string[]; temperature_2m?: unknown[]; weather_code?: unknown[]; precipitation_probability?: unknown[] } }, forecastAt: string, now = Date.now()) {
  const target = Date.parse(forecastAt);
  if (!Number.isFinite(target) || target < now - 60 * 60_000) return null;
  const hourly = data?.hourly;
  const index = (hourly?.time ?? []).findIndex(time => Math.abs(Date.parse(time + "Z") - target) <= 30 * 60_000);
  if (index < 0) return null;
  const tempC = hourly?.temperature_2m?.[index];
  const code = hourly?.weather_code?.[index];
  const precip = hourly?.precipitation_probability?.[index];
  if (typeof tempC !== "number" || !Number.isFinite(tempC) || typeof code !== "number" || !Number.isFinite(code)) return null;
  return { forecastAt, tempC, code, precipPct: typeof precip === "number" && precip >= 0 && precip <= 100 ? precip : undefined };
}
