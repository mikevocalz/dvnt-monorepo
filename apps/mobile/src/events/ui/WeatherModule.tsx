/**
 * WeatherModule — 7-day forecast for Event Details
 *
 * Uses Open-Meteo (free, global, no API key).
 * Highlights the event date card.
 * Shows location name in header.
 */

import { View, Text, ScrollView, Pressable } from "react-native";
import { useState, useCallback, useMemo } from "react";
import Animated, { FadeIn, FadeInDown, Layout } from "react-native-reanimated";
import {
  Sun,
  CloudSun,
  Cloud,
  CloudRain,
  CloudLightning,
  CloudSnow,
  CloudFog,
  Wind,
  Droplets,
  ChevronDown,
  ChevronUp,
  AlertTriangle,
  MapPin,
  Thermometer,
} from "lucide-react-native";
import { useWeatherForecast } from "@/lib/hooks/use-weather";
import { mapWeatherToIcon, type WeatherPeriod } from "@/lib/api/weather";

// ── Lucide icon mapping ─────────────────────────────────────────────

const WEATHER_ICONS: Record<string, typeof Sun> = {
  sun: Sun,
  "cloud-sun": CloudSun,
  cloud: Cloud,
  "cloud-rain": CloudRain,
  "cloud-lightning": CloudLightning,
  "cloud-snow": CloudSnow,
  "cloud-fog": CloudFog,
  wind: Wind,
};

const WEATHER_COLORS: Record<string, string> = {
  sun: "#FCD34D",
  "cloud-sun": "#93C5FD",
  cloud: "#9CA3AF",
  "cloud-rain": "#60A5FA",
  "cloud-lightning": "#A78BFA",
  "cloud-snow": "#E0E7FF",
  "cloud-fog": "#D1D5DB",
  wind: "#6EE7B7",
};

// ── Skeleton ────────────────────────────────────────────────────────

function WeatherSkeleton() {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ paddingHorizontal: 16, gap: 10 }}
    >
      {Array.from({ length: 7 }).map((_, i) => (
        <Animated.View
          key={i}
          entering={FadeIn.delay(i * 60).duration(300)}
          className="w-20 h-32 rounded-2xl bg-card"
          style={{ opacity: 0.5 }}
        />
      ))}
    </ScrollView>
  );
}

// ── Single Weather Card ─────────────────────────────────────────────

function WeatherCard({
  period,
  index,
  expanded,
  isEventDay,
  onToggle,
}: {
  period: WeatherPeriod;
  index: number;
  expanded: boolean;
  isEventDay: boolean;
  onToggle: () => void;
}) {
  const iconKey = mapWeatherToIcon(period.shortForecast, period.weatherCode);
  const IconComponent = WEATHER_ICONS[iconKey] || CloudSun;
  const iconColor = WEATHER_COLORS[iconKey] || "#93C5FD";

  const dayName = new Date(period.startTime + "T12:00:00").toLocaleDateString("en-US", {
    weekday: "short",
  });
  const precip = period.probabilityOfPrecipitation?.value;
  const tempLow = (period as any).temperatureLow;

  const borderColor = isEventDay ? "#8A40CF" : "rgba(255,255,255,0.08)";
  const bgColor = isEventDay ? "rgba(138,64,207,0.12)" : "rgba(255,255,255,0.04)";

  return (
    <Animated.View
      entering={FadeInDown.delay(index * 70)
        .duration(400)
        .springify()
        .damping(18)}
      layout={Layout.springify()}
    >
      <Pressable
        onPress={onToggle}
        style={{
          width: 88,
          minHeight: 168,
          borderRadius: 20,
          borderWidth: isEventDay ? 1.5 : 1,
          borderColor,
          backgroundColor: bgColor,
          paddingHorizontal: 12,
          paddingVertical: 12,
          alignItems: "center",
          gap: 6,
          position: "relative",
        }}
      >
        {/* Event day badge */}
        {isEventDay && (
          <View
            style={{
              position: "absolute",
              top: -8,
              backgroundColor: "#8A40CF",
              borderRadius: 6,
              paddingHorizontal: 6,
              paddingVertical: 2,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 9, fontWeight: "800" }}>
              EVENT
            </Text>
          </View>
        )}

        {/* Day label */}
        <Text
          style={{
            fontSize: 11,
            fontWeight: "600",
            color: isEventDay ? "#C084FC" : "rgba(255,255,255,0.5)",
            marginTop: isEventDay ? 4 : 0,
          }}
        >
          {index === 0 ? "Today" : dayName}
        </Text>

        {/* Icon */}
        <IconComponent size={28} color={iconColor} strokeWidth={1.8} />

        {/* Temp high */}
        <Text style={{ fontSize: 20, fontWeight: "800", color: "#fff" }}>
          {period.temperature}°
        </Text>

        {/* Temp low */}
        {tempLow != null && (
          <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.4)" }}>
            {tempLow}°
          </Text>
        )}

        {/* Short forecast */}
        <Text
          style={{
            fontSize: 10,
            color: "rgba(255,255,255,0.5)",
            textAlign: "center",
          }}
          numberOfLines={2}
        >
          {period.shortForecast}
        </Text>

        {/* Precipitation */}
        {precip != null && precip > 0 ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 2 }}>
            <Droplets size={10} color="#60A5FA" />
            <Text style={{ fontSize: 9, color: "#60A5FA" }}>{precip}%</Text>
          </View>
        ) : (
          <View style={{ height: 14 }} />
        )}

        {/* Expand chevron */}
        {expanded ? (
          <ChevronUp size={12} color="#666" />
        ) : (
          <ChevronDown size={12} color="#666" />
        )}
      </Pressable>

      {/* Expanded details */}
      {expanded && (
        <Animated.View
          entering={FadeInDown.duration(200)}
          style={{
            width: 88,
            marginTop: 4,
            backgroundColor: "rgba(255,255,255,0.04)",
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "rgba(255,255,255,0.08)",
            paddingHorizontal: 10,
            paddingVertical: 8,
            gap: 4,
          }}
        >
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Wind size={10} color="#6EE7B7" />
            <Text style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>
              {period.windSpeed} {period.windDirection}
            </Text>
          </View>
          {tempLow != null && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Thermometer size={10} color="#93C5FD" />
              <Text style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>
                Low {tempLow}°F
              </Text>
            </View>
          )}
          {precip != null && precip > 0 && (
            <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
              <Droplets size={10} color="#60A5FA" />
              <Text style={{ fontSize: 9, color: "rgba(255,255,255,0.5)" }}>
                {precip}% rain
              </Text>
            </View>
          )}
        </Animated.View>
      )}
    </Animated.View>
  );
}

// ── Error State ─────────────────────────────────────────────────────

function WeatherError() {
  return (
    <Animated.View
      entering={FadeIn.duration(300)}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 16,
        paddingVertical: 12,
        backgroundColor: "rgba(255,255,255,0.04)",
        borderRadius: 12,
        marginHorizontal: 16,
      }}
    >
      <AlertTriangle size={16} color="#F59E0B" />
      <Text style={{ fontSize: 12, color: "rgba(255,255,255,0.4)", flex: 1 }}>
        Weather forecast unavailable for this location
      </Text>
    </Animated.View>
  );
}

// ── Main Export ──────────────────────────────────────────────────────

export function WeatherModule({
  lat,
  lng,
  locationName,
  eventDate,
}: {
  lat?: number;
  lng?: number;
  locationName?: string;
  eventDate?: string; // ISO date string to highlight event day
}) {
  const { data: periods, isLoading, isError } = useWeatherForecast(lat, lng);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  // Determine which index matches the event date
  const eventDayIndex = useMemo(() => {
    if (!eventDate || !periods?.length) return -1;
    const eventDateStr = eventDate.split("T")[0]; // normalize to "YYYY-MM-DD"
    return periods.findIndex((p) => p.startTime === eventDateStr);
  }, [eventDate, periods]);

  const handleToggle = useCallback((index: number) => {
    setExpandedIndex((prev) => (prev === index ? null : index));
  }, []);

  if (!lat || !lng) return null;
  if (isLoading) return <WeatherSkeleton />;
  if (isError || !periods?.length) return <WeatherError />;

  const eventPeriod = eventDayIndex >= 0 ? periods[eventDayIndex] : null;

  return (
    <Animated.View entering={FadeIn.duration(400)}>
      {/* Header */}
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: 16,
          marginBottom: 10,
        }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ fontSize: 14, fontWeight: "700", color: "#fff" }}>
            7-Day Forecast
          </Text>
        </View>
        {locationName ? (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <MapPin size={11} color="#3FDCFF" />
            <Text
              style={{ fontSize: 11, color: "#3FDCFF", fontWeight: "600" }}
              numberOfLines={1}
            >
              {locationName}
            </Text>
          </View>
        ) : null}
      </View>

      {/* Event day summary banner */}
      {eventPeriod && (
        <Animated.View
          entering={FadeInDown.duration(300)}
          style={{
            marginHorizontal: 16,
            marginBottom: 10,
            backgroundColor: "rgba(138,64,207,0.15)",
            borderWidth: 1,
            borderColor: "rgba(138,64,207,0.4)",
            borderRadius: 14,
            padding: 12,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          {(() => {
            const iconKey = mapWeatherToIcon(eventPeriod.shortForecast, eventPeriod.weatherCode);
            const Icon = WEATHER_ICONS[iconKey] || CloudSun;
            const color = WEATHER_COLORS[iconKey] || "#93C5FD";
            return <Icon size={24} color={color} strokeWidth={1.8} />;
          })()}
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 12, fontWeight: "700", color: "#C084FC" }}>
              Event Day Weather
            </Text>
            <Text style={{ fontSize: 13, color: "#fff", fontWeight: "600" }}>
              {eventPeriod.shortForecast} · {eventPeriod.temperature}°F
              {(eventPeriod as any).temperatureLow != null
                ? ` / ${(eventPeriod as any).temperatureLow}°F`
                : ""}
            </Text>
            {(eventPeriod.probabilityOfPrecipitation?.value ?? 0) > 0 && (
              <Text style={{ fontSize: 11, color: "#60A5FA", marginTop: 2 }}>
                {eventPeriod.probabilityOfPrecipitation?.value}% chance of rain
              </Text>
            )}
          </View>
        </Animated.View>
      )}

      {/* Scrollable day cards */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          gap: 10,
          paddingTop: 14,
          paddingBottom: 4,
        }}
      >
        {periods.map((period, index) => (
          <WeatherCard
            key={period.number}
            period={period}
            index={index}
            isEventDay={index === eventDayIndex}
            expanded={expandedIndex === index}
            onToggle={() => handleToggle(index)}
          />
        ))}
      </ScrollView>
    </Animated.View>
  );
}
