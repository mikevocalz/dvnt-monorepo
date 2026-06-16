/**
 * Open-Meteo Weather API Client
 *
 * Free, no API key, global coverage (replaces NOAA which is US-only).
 * Docs: https://open-meteo.com/en/docs
 *
 * Single fetch:
 *   GET /v1/forecast?latitude=&longitude=&daily=...&timezone=auto&forecast_days=7
 */

export interface WeatherPeriod {
  number: number;
  name: string;
  startTime: string;       // ISO date string "2026-04-13"
  endTime: string;
  isDaytime: boolean;
  temperature: number;     // high temp (°F)
  temperatureLow: number;  // low temp (°F)
  temperatureUnit: string;
  windSpeed: string;
  windDirection: string;
  shortForecast: string;
  detailedForecast: string;
  probabilityOfPrecipitation?: { value: number | null };
  icon: string;
  weatherCode: number;
}

const TIMEOUT_MS = 8000;

// WMO weather interpretation codes → human label
function wmoToLabel(code: number): string {
  if (code === 0) return "Clear Sky";
  if (code <= 2) return "Partly Cloudy";
  if (code === 3) return "Overcast";
  if (code <= 49) return "Foggy";
  if (code <= 59) return "Drizzle";
  if (code <= 69) return "Rain";
  if (code <= 79) return "Snow";
  if (code <= 82) return "Rain Showers";
  if (code <= 84) return "Snow Showers";
  if (code <= 99) return "Thunderstorm";
  return "Cloudy";
}

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

// Celsius → Fahrenheit
function cToF(c: number): number {
  return Math.round(c * 9 / 5 + 32);
}

export async function getWeatherForecast(
  lat: number,
  lng: number,
): Promise<WeatherPeriod[]> {
  const url =
    `https://api.open-meteo.com/v1/forecast` +
    `?latitude=${lat.toFixed(4)}&longitude=${lng.toFixed(4)}` +
    `&daily=weather_code,temperature_2m_max,temperature_2m_min,` +
    `precipitation_probability_max,windspeed_10m_max,winddirection_10m_dominant` +
    `&temperature_unit=fahrenheit` +
    `&windspeed_unit=mph` +
    `&timezone=auto` +
    `&forecast_days=7`;

  const res = await fetchWithTimeout(url);
  if (!res.ok) throw new Error(`Open-Meteo failed: ${res.status}`);

  const data = await res.json();
  const d = data.daily;
  if (!d?.time?.length) throw new Error("No forecast data");

  // Support both the current field name (weather_code) and the legacy alias (weathercode)
  const weatherCodes: number[] = d.weather_code ?? d.weathercode ?? [];

  return d.time.map((date: string, i: number) => {
    const code: number = weatherCodes[i] ?? 1;
    const label = wmoToLabel(code);
    const tempHigh = Math.round((d.temperature_2m_max ?? [])[i] ?? 70);
    const tempLow = Math.round((d.temperature_2m_min ?? [])[i] ?? 55);
    const precip = (d.precipitation_probability_max ?? [])[i] ?? null;
    const windSpd = Math.round((d.windspeed_10m_max ?? [])[i] ?? 0);
    const windDir = compassDirection((d.winddirection_10m_dominant ?? [])[i] ?? 0);

    return {
      number: i + 1,
      name: date,
      startTime: date,
      endTime: date,
      isDaytime: true,
      temperature: tempHigh,
      temperatureLow: tempLow,
      temperatureUnit: "F",
      windSpeed: `${windSpd} mph`,
      windDirection: windDir,
      shortForecast: label,
      detailedForecast: label,
      probabilityOfPrecipitation: { value: precip },
      icon: "",
      weatherCode: code,
    };
  });
}

function compassDirection(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return dirs[Math.round(deg / 45) % 8];
}

/**
 * Map WMO code or shortForecast text to a Lucide icon name.
 */
export function mapWeatherToIcon(shortForecast: string, weatherCode?: number): string {
  if (weatherCode != null) {
    if (weatherCode >= 95) return "cloud-lightning";
    if (weatherCode >= 71) return "cloud-snow";
    if (weatherCode >= 51) return "cloud-rain";
    if (weatherCode >= 45) return "cloud-fog";
    if (weatherCode === 3) return "cloud";
    if (weatherCode <= 2) return weatherCode === 0 ? "sun" : "cloud-sun";
  }

  const lower = shortForecast.toLowerCase();
  if (lower.includes("thunder")) return "cloud-lightning";
  if (lower.includes("snow") || lower.includes("sleet")) return "cloud-snow";
  if (lower.includes("rain") || lower.includes("shower") || lower.includes("drizzle")) return "cloud-rain";
  if (lower.includes("fog") || lower.includes("haze") || lower.includes("mist")) return "cloud-fog";
  if (lower.includes("partly") || lower.includes("mostly sunny")) return "cloud-sun";
  if (lower.includes("cloud") || lower.includes("overcast")) return "cloud";
  if (lower.includes("clear") || lower.includes("sunny") || lower.includes("fair")) return "sun";
  if (lower.includes("wind")) return "wind";

  return "cloud-sun";
}
