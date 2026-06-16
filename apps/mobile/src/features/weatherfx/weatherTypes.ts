/**
 * Weather FX — Type definitions and Open-Meteo code mapping
 *
 * Open-Meteo WMO weather codes → internal WeatherEffect enum.
 * Intensity computed from wind speed, precipitation rate, and code severity.
 */

// ── Open-Meteo WMO Weather Codes (groups we care about) ─────────────
export const OPEN_METEO_CLEAR = [0, 1] as const;
export const OPEN_METEO_CLOUDS = [2, 3] as const;
export const OPEN_METEO_FOG = [45, 48] as const;
export const OPEN_METEO_DRIZZLE = [51, 53, 55] as const;
export const OPEN_METEO_RAIN = [61, 63, 65] as const;
export const OPEN_METEO_SNOW = [71, 73, 75] as const;
export const OPEN_METEO_THUNDER = [95, 99] as const;

// ── WeatherEffect enum ──────────────────────────────────────────────
export enum WeatherEffect {
  None = "none",
  Clear = "clear",
  Cloudy = "cloudy",
  Fog = "fog",
  Rain = "rain",
  HeavyRain = "heavy_rain",
  Snow = "snow",
  Thunder = "thunder",
}

// ── Metrics from Open-Meteo API ─────────────────────────────────────
export interface WeatherMetrics {
  windSpeed: number; // km/h
  precipitation: number; // mm/h
  temperature: number; // °C
  humidity: number; // %
  cloudCover: number; // %
}

// ── Computed intensity for GPU layers ───────────────────────────────
export interface WeatherIntensity {
  particleCount: number;
  windVector: [number, number]; // normalised (x, y) direction
  opacity: number; // 0–1 base opacity
  thunderChance: number; // 0–1 probability per second
  fogDensity: number; // 0–1
  speed: number; // multiplier 0–2
}

// ── Cinematic phase ─────────────────────────────────────────────────
export enum CinematicPhase {
  Idle = "idle",
  Playing = "playing",
  FadingOut = "fading_out",
  Done = "done",
}

// ── Layer draw config ───────────────────────────────────────────────
export interface LayerUniforms {
  time: number;
  dt: number;
  resolution: [number, number];
  opacity: number;
  windX: number;
  windY: number;
  intensity: number;
  speed: number;
}

// ── Map Open-Meteo code → WeatherEffect ─────────────────────────────
export function mapWeatherCodeToEffect(code: number): WeatherEffect {
  if ((OPEN_METEO_CLEAR as readonly number[]).includes(code))
    return WeatherEffect.Clear;
  if ((OPEN_METEO_CLOUDS as readonly number[]).includes(code))
    return WeatherEffect.Cloudy;
  if ((OPEN_METEO_FOG as readonly number[]).includes(code))
    return WeatherEffect.Fog;
  if ((OPEN_METEO_DRIZZLE as readonly number[]).includes(code))
    return WeatherEffect.Rain;
  if (code === 65) return WeatherEffect.HeavyRain;
  if ((OPEN_METEO_RAIN as readonly number[]).includes(code))
    return WeatherEffect.Rain;
  if ((OPEN_METEO_SNOW as readonly number[]).includes(code))
    return WeatherEffect.Snow;
  if ((OPEN_METEO_THUNDER as readonly number[]).includes(code))
    return WeatherEffect.Thunder;
  return WeatherEffect.None;
}

// ── Compute intensity from metrics + code ───────────────────────────
export function computeIntensity(
  code: number,
  metrics: WeatherMetrics | null,
): WeatherIntensity {
  const effect = mapWeatherCodeToEffect(code);
  const wind = metrics?.windSpeed ?? 0;
  const precip = metrics?.precipitation ?? 0;
  const cloud = metrics?.cloudCover ?? 0;

  // Wind direction: derive from wind speed magnitude (simplified — real impl would use wind direction)
  const windAngle = Math.PI * 0.15; // slight rightward drift
  const windMag = Math.min(wind / 60, 1); // normalise to 0–1
  const windVector: [number, number] = [
    Math.sin(windAngle) * windMag,
    Math.cos(windAngle) * windMag,
  ];

  const base: WeatherIntensity = {
    particleCount: 0,
    windVector,
    opacity: 0,
    thunderChance: 0,
    fogDensity: 0,
    speed: 1,
  };

  switch (effect) {
    case WeatherEffect.Rain:
      return {
        ...base,
        particleCount: Math.round(200 + precip * 40),
        opacity: 0.35 + Math.min(precip / 10, 0.4),
        speed: 1 + windMag * 0.5,
      };
    case WeatherEffect.HeavyRain:
      return {
        ...base,
        particleCount: Math.round(500 + precip * 60),
        opacity: 0.5 + Math.min(precip / 15, 0.35),
        speed: 1.3 + windMag * 0.7,
      };
    case WeatherEffect.Snow:
      return {
        ...base,
        particleCount: Math.round(150 + precip * 30),
        opacity: 0.4 + Math.min(precip / 8, 0.4),
        speed: 0.3 + windMag * 0.2,
      };
    case WeatherEffect.Fog:
      return {
        ...base,
        fogDensity: 0.4 + Math.min(cloud / 100, 0.5),
        opacity: 0.3 + Math.min(cloud / 150, 0.4),
        speed: 0.15,
      };
    case WeatherEffect.Thunder:
      return {
        ...base,
        particleCount: Math.round(400 + precip * 50),
        opacity: 0.55,
        thunderChance: 0.15 + Math.min(precip / 20, 0.3),
        speed: 1.5 + windMag * 0.6,
      };
    case WeatherEffect.Clear:
      return {
        ...base,
        particleCount: 30,
        opacity: 0.08,
        speed: 0.08,
      };
    case WeatherEffect.Cloudy:
      return {
        ...base,
        particleCount: 50,
        fogDensity: Math.min(cloud / 200, 0.25),
        opacity: 0.15,
        speed: 0.12,
      };
    default:
      return base;
  }
}

// ── Brand colors per effect (hex + normalised RGB) ──────────────────
export const WEATHER_BRAND_COLORS: Record<
  WeatherEffect,
  { hex: string; rgb: [number, number, number] }
> = {
  [WeatherEffect.Rain]: { hex: "#8A40CF", rgb: [0.541, 0.251, 0.812] },
  [WeatherEffect.HeavyRain]: { hex: "#8A40CF", rgb: [0.541, 0.251, 0.812] },
  [WeatherEffect.Snow]: { hex: "#3FDCFF", rgb: [0.247, 0.863, 1.0] },
  [WeatherEffect.Clear]: { hex: "#FC253A", rgb: [0.988, 0.145, 0.227] },
  [WeatherEffect.Thunder]: { hex: "#8A40CF", rgb: [0.541, 0.251, 0.812] },
  [WeatherEffect.Fog]: { hex: "#3FDCFF", rgb: [0.247, 0.863, 1.0] },
  [WeatherEffect.Cloudy]: { hex: "#3FDCFF", rgb: [0.247, 0.863, 1.0] },
  [WeatherEffect.None]: { hex: "#FFFFFF", rgb: [1, 1, 1] },
};

// ── Severity scoring (higher = more severe) ────────────────────────
// Used to detect weather worsening so FX burst re-triggers.
// Within the same category (e.g. rain), heavier codes score higher.
export function getWeatherSeverity(code: number): number {
  const SEVERITY_MAP: Record<number, number> = {
    0: 0,
    1: 1, // Clear
    2: 2,
    3: 3, // Cloudy
    45: 4,
    48: 5, // Fog
    51: 6,
    53: 7,
    55: 8, // Drizzle (light → dense)
    61: 9,
    63: 10,
    65: 11, // Rain (slight → heavy)
    71: 9,
    73: 10,
    75: 11, // Snow (slight → heavy / nor'easter)
    95: 12,
    99: 13, // Thunderstorm → thunderstorm w/ hail
  };
  return SEVERITY_MAP[code] ?? 0;
}

// ── Burst duration for particle FX ──────────────────────────────────
export const BURST_DURATION_MS = 30_000; // 30 seconds

// ── Default intensity (no weather) ──────────────────────────────────
export const DEFAULT_INTENSITY: WeatherIntensity = {
  particleCount: 0,
  windVector: [0, 0],
  opacity: 0,
  thunderChance: 0,
  fogDensity: 0,
  speed: 1,
};
