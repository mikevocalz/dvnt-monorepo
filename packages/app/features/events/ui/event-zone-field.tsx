/**
 * Time zone field for the native create and edit screens.
 *
 * Six one-tap zones, then a search over every IANA zone. The picked zone
 * decides how the date/time pickers above it are read, so the caption names it.
 * Results are capped at eight rows and rendered inline: the field sits inside
 * the screen's KeyboardAwareScrollView, and a nested virtualized list there
 * would fight the outer scroll.
 */

import { memo, useMemo, useState } from "react";
import { View, Text, Pressable, TextInput } from "react-native";
import { Globe } from "lucide-react-native";
import {
  QUICK_ZONES,
  searchTimeZones,
  zoneDisplayName,
} from "@dvnt/app/lib/events/event-zone";

export const EventZonePicker = memo(function EventZonePicker({
  value,
  onChange,
  at,
  accent,
  muted,
}: {
  value: string;
  onChange: (tz: string) => void;
  /** Instant used for the abbreviation (the event start), so PDT vs PST is right. */
  at?: string | null;
  accent: string;
  muted: string;
}) {
  const [query, setQuery] = useState("");
  const when = at && !Number.isNaN(Date.parse(at)) ? Date.parse(at) : Date.now();
  const results = useMemo(
    () => (query.trim() ? searchTimeZones(query, 8, when) : []),
    [query, when],
  );
  const chips = QUICK_ZONES.some((z) => z.id === value)
    ? QUICK_ZONES
    : [{ id: value, label: value.replace(/_/g, " ") }, ...QUICK_ZONES];

  const pick = (tz: string) => {
    onChange(tz);
    setQuery("");
  };

  return (
    <View className="bg-card rounded-2xl p-4 gap-3 mt-3">
      <View className="flex-row items-center gap-3">
        <View className="w-10 h-10 rounded-xl bg-muted items-center justify-center">
          <Globe size={18} color={accent} />
        </View>
        <View className="flex-1">
          <Text className="text-xs text-muted-foreground mb-0.5">Time zone</Text>
          <Text className="text-sm font-semibold text-foreground" selectable>
            {zoneDisplayName(value, when)}
          </Text>
        </View>
      </View>

      <View className="flex-row flex-wrap gap-2">
        {chips.map((z) => {
          const on = z.id === value;
          return (
            <Pressable
              key={z.id}
              onPress={() => pick(z.id)}
              accessibilityRole="button"
              accessibilityState={{ selected: on }}
              accessibilityLabel={`${z.label} time`}
              hitSlop={4}
              className={`h-8 px-3 rounded-full items-center justify-center border ${
                on ? "bg-primary border-primary" : "bg-muted border-border"
              }`}
            >
              <Text
                className={`text-[13px] font-semibold ${
                  on ? "text-primary-foreground" : "text-foreground"
                }`}
              >
                {z.label}
              </Text>
            </Pressable>
          );
        })}
      </View>

      <TextInput
        value={query}
        onChangeText={setQuery}
        placeholder="Search any city or zone"
        placeholderTextColor={muted}
        autoCorrect={false}
        autoCapitalize="none"
        returnKeyType="search"
        onSubmitEditing={() => results[0] && pick(results[0])}
        accessibilityLabel="Search all time zones"
        className="bg-muted rounded-xl px-3 h-10 text-[15px] text-foreground"
      />

      {results.length > 0 ? (
        <View className="rounded-xl overflow-hidden bg-muted">
          {results.map((tz) => (
            <Pressable
              key={tz}
              onPress={() => pick(tz)}
              accessibilityRole="button"
              accessibilityState={{ selected: tz === value }}
              className="px-3 py-2.5 active:opacity-70"
            >
              <Text className="text-sm text-foreground">{zoneDisplayName(tz, when)}</Text>
            </Pressable>
          ))}
        </View>
      ) : query.trim() ? (
        <Text className="text-xs text-muted-foreground">
          No zone matches “{query.trim()}”.
        </Text>
      ) : null}

      <Text className="text-xs text-muted-foreground">
        Start and end times are in {zoneDisplayName(value, when)}.
      </Text>
    </View>
  );
});
