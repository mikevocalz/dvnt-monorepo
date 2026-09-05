import type { WatchEvent, WatchEventWeather } from "./watch-event-payload";
import type { LiveSurfacePayload } from "../live-surface/types";
/** Memory-only, one published venue per 15 minutes per account generation. */
export function createWatchVenueWeatherLoader(fetcher: (opts: { lat: number; lng: number; forecastAt?: string; shouldContinue: () => boolean }) => Promise<LiveSurfacePayload | null>) {
  let cache: { generation: string; eventId: string; attemptedAt: number; result: Promise<WatchEventWeather | undefined> } | undefined;
  return async (events: WatchEvent[], generation: string, shouldContinue: () => boolean, now = Date.now()): Promise<WatchEvent[]> => {
    const focus = events.find((e) => e.status === "active" && !e.isOnline && Number.isFinite(e.latitude) && Number.isFinite(e.longitude) && Math.abs(e.latitude!) <= 90 && Math.abs(e.longitude!) <= 180 && Date.parse(e.endAt ?? e.startAt ?? "") >= now);
    if (!focus || !shouldContinue()) return events;
    if (cache?.generation !== generation) cache = undefined;
    if (!cache || now - cache.attemptedAt >= 15 * 60_000) {
      cache = { generation, eventId: focus.id, attemptedAt: now, result: (async () => {
        let timer: ReturnType<typeof setTimeout> | undefined;
        const payload = await Promise.race([
          fetcher({ lat: focus.latitude!, lng: focus.longitude!, forecastAt: focus.startAt, shouldContinue }),
          new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), 8_000); }),
        ]).finally(() => { if (timer) clearTimeout(timer); });
        const weather = payload?.weather;
        const stamp = Date.parse(payload?.generatedAt ?? "");
        if (!shouldContinue() || !weather || typeof weather.tempF !== "number" || !Number.isFinite(weather.tempF) || !Number.isFinite(stamp)) return undefined;
        return { forecastAt: weather.forecastAt, tempF: weather.tempF, label: typeof weather.label === "string" ? weather.label.slice(0, 80) : undefined, generatedAt: new Date(stamp).toISOString(), precipPct: typeof weather.precipPct === "number" && weather.precipPct >= 0 && weather.precipPct <= 100 ? weather.precipPct : undefined };
      })().catch(() => undefined) };
    }
    const current = cache;
    if (current.eventId !== focus.id) return events;
    const weather = await current.result;
    if (!weather || !shouldContinue() || cache !== current) return events;
    return events.map((event) => event.id === focus.id ? { ...event, weather } : event);
  };
}
