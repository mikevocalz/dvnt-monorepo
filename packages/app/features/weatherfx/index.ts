/**
 * Weather FX — Barrel export
 *
 * Brand colors: Rain=#8A40CF Snow=#3FDCFF Sunny=#FC253A
 */

// Types + mapping
export {
  WeatherEffect,
  CinematicPhase,
  WEATHER_BRAND_COLORS,
  DEFAULT_INTENSITY,
  mapWeatherCodeToEffect,
  computeIntensity,
} from "./weatherTypes";
export type {
  WeatherMetrics,
  WeatherIntensity,
  LayerUniforms,
} from "./weatherTypes";

// Store
export { useWeatherFXStore } from "./WeatherFXStore";

// Decision engine
export {
  fetchCurrentWeather,
  fetchEventForecast,
  applyWeatherToStore,
  refreshWeather,
  refreshEventForecast,
} from "./WeatherDecisionEngine";

// Main component
export { WeatherGPUEngine } from "./WeatherGPUEngine";

// Hooks
export { useEventsTabVisibility } from "./hooks/useEventsTabVisibility";
export { useWeatherRefresh } from "./hooks/useWeatherRefresh";
