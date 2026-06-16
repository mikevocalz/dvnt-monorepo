import React from "react";
import { View, Text, ScrollView } from "react-native";
import {
  Sun,
  Cloud,
  CloudRain,
  CloudSnow,
  CloudLightning,
  CloudSun,
  CloudFog,
  Wind,
} from "lucide-react-native";
import { useWeatherForecast } from "@/lib/hooks/use-weather";
import { mapWeatherToIcon, type WeatherPeriod } from "@/lib/api/weather";

interface WeatherStripProps {
  lat?: number;
  lng?: number;
}

const ICON_MAP: Record<string, React.FC<any>> = {
  sun: Sun,
  cloud: Cloud,
  "cloud-rain": CloudRain,
  "cloud-snow": CloudSnow,
  "cloud-lightning": CloudLightning,
  "cloud-sun": CloudSun,
  "cloud-fog": CloudFog,
  wind: Wind,
};

function WeatherIcon({
  iconKey,
  size = 18,
}: {
  iconKey: string;
  size?: number;
}) {
  const Icon = ICON_MAP[iconKey] || CloudSun;
  const color =
    iconKey === "sun"
      ? "#FBBF24"
      : iconKey === "cloud-rain" || iconKey === "cloud-snow"
        ? "#60A5FA"
        : iconKey === "cloud-lightning"
          ? "#F59E0B"
          : "#94A3B8";
  return <Icon size={size} color={color} strokeWidth={1.8} />;
}

function getDayLabel(period: WeatherPeriod, index: number): string {
  if (index === 0) return "Today";
  const date = new Date(period.startTime);
  return date.toLocaleDateString("en-US", { weekday: "short" });
}

function WeatherStripSkeleton() {
  return (
    <View className="py-2">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}
      >
        {Array.from({ length: 7 }).map((_, i) => (
          <View
            key={i}
            className="items-center px-3 py-2.5 rounded-2xl"
            style={{ backgroundColor: "rgba(255,255,255,0.04)", minWidth: 64 }}
          >
            <View
              style={{
                width: 28,
                height: 10,
                borderRadius: 4,
                backgroundColor: "rgba(255,255,255,0.08)",
                marginBottom: 6,
              }}
            />
            <View
              style={{
                width: 20,
                height: 20,
                borderRadius: 10,
                backgroundColor: "rgba(255,255,255,0.08)",
                marginBottom: 6,
              }}
            />
            <View
              style={{
                width: 24,
                height: 14,
                borderRadius: 4,
                backgroundColor: "rgba(255,255,255,0.08)",
              }}
            />
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

export const WeatherStrip: React.FC<WeatherStripProps> = ({ lat, lng }) => {
  const { data: periods, isLoading, isError } = useWeatherForecast(lat, lng);

  const hasPeriods = Array.isArray(periods) && periods.length > 0;

  // Show skeleton while loading (never return null — prevents layout shift)
  if (isLoading && !hasPeriods) return <WeatherStripSkeleton />;
  // If fetch failed and no cached data, silently hide
  if (isError && !hasPeriods) return null;
  // No data at all (no coords provided)
  if (!hasPeriods) return <WeatherStripSkeleton />;

  return (
    <View className="py-2">
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 16, gap: 6 }}
      >
        {periods.slice(0, 7).map((period, idx) => {
          const iconKey = mapWeatherToIcon(period.shortForecast);
          return (
            <View
              key={`${period.startTime}-${idx}`}
              className="items-center px-3 py-2.5 rounded-2xl"
              style={{
                backgroundColor: "rgba(255,255,255,0.04)",
                minWidth: 64,
              }}
            >
              <Text className="text-[11px] font-semibold text-neutral-500 mb-1.5">
                {getDayLabel(period, idx)}
              </Text>
              <WeatherIcon iconKey={iconKey} size={20} />
              <Text className="text-sm font-bold text-white mt-1.5">
                {period.temperature}°
              </Text>
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
};
