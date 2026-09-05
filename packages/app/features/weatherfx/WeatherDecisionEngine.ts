/**
 * Weather Decision Engine
 *
 * Fetches current weather from Open-Meteo (free, no API key) and maps
 * the WMO code + metrics into the WeatherFX store.
 *
 * Supports event-time forecast override: if an upcoming event has a
 * specific date/location, the forecast for that time takes priority
 * over current conditions for the Events tab experience.
 */
import {
  mapWeatherCodeToEffect,
  computeIntensity,
  type WeatherMetrics,
} from "./weatherTypes";
import { useWeatherFXStore } from "./WeatherFXStore";

// ── Open-Meteo response shape (subset) ──────────────────────────────
interface OpenMeteoCurrentWeather {
  weathercode: number;
  temperature: number;
  windspeed: number;
  winddirection: number;
}

interface OpenMeteoCurrent {
  weather_code: number;
  temperature_2m: number;
  wind_speed_10m: number;
  relative_humidity_2m: number;
  cloud_cover: number;
  precipitation: number;
}

interface OpenMeteoResponse {
  current_weather?: OpenMeteoCurrentWeather;
  current?: OpenMeteoCurrent;
}

// ── Hourly forecast shape ───────────────────────────────────────────
interface OpenMeteoHourlyResponse {
  hourly?: {
    time: string[];
    weather_code: number[];
    temperature_2m: number[];
    wind_speed_10m: number[];
    precipitation: number[];
    relative_humidity_2m: number[];
    cloud_cover: number[];
  };
}

const OPEN_METEO_BASE = "https://api.open-meteo.com/v1/forecast";

// ── Fetch current weather ───────────────────────────────────────────
export async function fetchCurrentWeather(
  lat: number,
  lng: number,
): Promise<{ code: number; metrics: WeatherMetrics } | null> {
  try {
    const url =
      `${OPEN_METEO_BASE}?latitude=${lat}&longitude=${lng}` +
      `&current=weather_code,temperature_2m,wind_speed_10m,relative_humidity_2m,cloud_cover,precipitation` +
      `&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) {
      console.warn("[WeatherDecision] Open-Meteo HTTP", res.status);
      return null;
    }

    const data: OpenMeteoResponse = await res.json();

    if (data.current) {
      return {
        code: data.current.weather_code,
        metrics: {
          windSpeed: data.current.wind_speed_10m,
          precipitation: data.current.precipitation,
          temperature: data.current.temperature_2m,
          humidity: data.current.relative_humidity_2m,
          cloudCover: data.current.cloud_cover,
        },
      };
    }

    // Fallback to legacy current_weather field
    if (data.current_weather) {
      return {
        code: data.current_weather.weathercode,
        metrics: {
          windSpeed: data.current_weather.windspeed,
          precipitation: 0,
          temperature: data.current_weather.temperature,
          humidity: 50,
          cloudCover: 50,
        },
      };
    }

    return null;
  } catch (err) {
    console.warn("[WeatherDecision] fetch failed:", err);
    return null;
  }
}

// ── Fetch hourly forecast for a specific future date/time ───────────
export async function fetchEventForecast(
  lat: number,
  lng: number,
  eventDate: string, // ISO 8601
): Promise<{ code: number; metrics: WeatherMetrics } | null> {
  try {
    const eventTime = new Date(eventDate);
    const dateStr = eventTime.toISOString().split("T")[0];

    const url =
      `${OPEN_METEO_BASE}?latitude=${lat}&longitude=${lng}` +
      `&hourly=weather_code,temperature_2m,wind_speed_10m,precipitation,relative_humidity_2m,cloud_cover` +
      `&start_date=${dateStr}&end_date=${dateStr}` +
      `&timezone=auto`;

    const res = await fetch(url);
    if (!res.ok) return null;

    const data: OpenMeteoHourlyResponse = await res.json();
    if (!data.hourly?.time?.length) return null;

    // Find closest hour
    const targetHour = eventTime.getHours();
    const hourIndex = Math.min(targetHour, data.hourly.time.length - 1);

    return {
      code: data.hourly.weather_code[hourIndex],
      metrics: {
        windSpeed: data.hourly.wind_speed_10m[hourIndex],
        precipitation: data.hourly.precipitation[hourIndex],
        temperature: data.hourly.temperature_2m[hourIndex],
        humidity: data.hourly.relative_humidity_2m[hourIndex],
        cloudCover: data.hourly.cloud_cover[hourIndex],
      },
    };
  } catch (err) {
    console.warn("[WeatherDecision] forecast fetch failed:", err);
    return null;
  }
}

// ── Update store with weather data ──────────────────────────────────
export function applyWeatherToStore(
  code: number,
  metrics: WeatherMetrics,
): void {
  const store = useWeatherFXStore.getState();
  store.setWeather(code, metrics);

  if (__DEV__) {
    const effect = mapWeatherCodeToEffect(code);
    const intensity = computeIntensity(code, metrics);
    console.log(
      `[WeatherDecision] code=${code} → ${effect}, particles=${intensity.particleCount}, opacity=${intensity.opacity.toFixed(2)}`,
    );
  }
}

// ── Convenience: fetch + apply in one call ──────────────────────────
export async function refreshWeather(
  lat: number,
  lng: number,
): Promise<boolean> {
  const result = await fetchCurrentWeather(lat, lng);
  if (!result) return false;
  applyWeatherToStore(result.code, result.metrics);
  return true;
}

// ── Convenience: fetch event forecast + apply ───────────────────────
export async function refreshEventForecast(
  lat: number,
  lng: number,
  eventDate: string,
): Promise<boolean> {
  const result = await fetchEventForecast(lat, lng, eventDate);
  if (!result) return false;
  applyWeatherToStore(result.code, result.metrics);
  return true;
}
