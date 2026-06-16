"use client";
/**
 * WeatherStrip (web) — the web port of weather-strip.tsx: a horizontal forecast
 * strip for an event's location. Shares the universal useWeatherForecast hook +
 * mapWeatherToIcon; renders with divs + lucide-react instead of RN primitives.
 */
import {
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudSun,
  CloudFog,
  Wind,
} from "lucide-react";
import { useWeatherForecast } from "@dvnt/app/lib/hooks/use-weather";
import { mapWeatherToIcon, type WeatherPeriod } from "@dvnt/app/lib/api/weather";

const ICON_MAP: Record<string, typeof Sun> = {
  sun: Sun,
  cloud: Cloud,
  "cloud-rain": CloudRain,
  "cloud-snow": CloudSnow,
  "cloud-lightning": CloudLightning,
  "cloud-sun": CloudSun,
  "cloud-fog": CloudFog,
  wind: Wind,
};

function iconColor(key: string): string {
  if (key === "sun") return "#FBBF24";
  if (key === "cloud-rain" || key === "cloud-snow") return "#60A5FA";
  if (key === "cloud-lightning") return "#F59E0B";
  return "#94A3B8";
}

function dayLabel(period: WeatherPeriod, index: number): string {
  if (index === 0) return "Today";
  return new Date(period.startTime).toLocaleDateString("en-US", { weekday: "short" });
}

export function WeatherStrip({ lat, lng }: { lat?: number; lng?: number }) {
  const { data: periods, isError } = useWeatherForecast(lat, lng);
  const hasPeriods = Array.isArray(periods) && periods.length > 0;
  // Silently hide when there's no data (or fetch failed) — never a broken box.
  if (!hasPeriods) {
    if (isError) return null;
    return null;
  }
  return (
    <div className="flex gap-1.5 overflow-x-auto py-1">
      {periods.slice(0, 7).map((period, idx) => {
        const key = mapWeatherToIcon(period.shortForecast);
        const Icon = ICON_MAP[key] || CloudSun;
        return (
          <div
            key={`${period.startTime}-${idx}`}
            className="flex min-w-[64px] flex-col items-center rounded-2xl bg-white/[0.04] px-3 py-2.5"
          >
            <span className="mb-1.5 text-[11px] font-semibold text-white/40">
              {dayLabel(period, idx)}
            </span>
            <Icon size={20} color={iconColor(key)} strokeWidth={1.8} />
            <span className="mt-1.5 text-sm font-bold text-white">
              {period.temperature}°
            </span>
          </div>
        );
      })}
    </div>
  );
}
