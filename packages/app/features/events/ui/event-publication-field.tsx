/**
 * "Hide event" and "Go public at" for the native create and edit screens (E06).
 *
 * The go-public time is when the listing appears, not the event's date. The
 * picker shows and returns a device-local Date whose fields are the wall clock;
 * it is read in the event's zone on save, like the event start.
 * Hiding wins over the schedule: a hidden event stays hidden after that time.
 */

import { memo, useState } from "react";
import { Platform, Pressable, Switch, Text, View } from "react-native";
import DateTimePicker from "@react-native-community/datetimepicker";
import { CalendarClock, EyeOff } from "lucide-react-native";
import { zoneDisplayName } from "@dvnt/app/lib/events/event-zone";

export const EventPublicationField = memo(function EventPublicationField({
  isHidden,
  onHiddenChange,
  publishAt,
  onPublishAtChange,
  eventTz,
  error,
  accent,
  muted,
}: {
  isHidden: boolean;
  onHiddenChange: (v: boolean) => void;
  /** Device-local ISO holding the typed wall clock, or "" for none. */
  publishAt: string;
  onPublishAtChange: (localIso: string) => void;
  eventTz: string;
  error?: string | null;
  accent: string;
  muted: string;
}) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const picked = publishAt ? new Date(publishAt) : null;
  const label = picked
    ? picked.toLocaleString("en-US", {
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "As soon as you publish";

  return (
    <View className="gap-3 mt-3">
      <View className="flex-row items-center justify-between bg-card rounded-2xl p-4">
        <View className="flex-row items-center gap-3 flex-1 mr-3">
          <View className="w-10 h-10 rounded-xl bg-muted items-center justify-center">
            <EyeOff size={18} color={accent} />
          </View>
          <View className="flex-1">
            <Text className="text-sm font-semibold text-foreground">Hide event</Text>
            <Text className="text-xs text-muted-foreground">
              Only you, co-hosts, invited guests and ticket holders can open it
            </Text>
          </View>
        </View>
        <Switch
          value={isHidden}
          onValueChange={onHiddenChange}
          trackColor={{ false: "#333", true: accent }}
          thumbColor="#fff"
          accessibilityLabel="Hide event"
        />
      </View>

      <View
        className="bg-card rounded-2xl p-4 gap-2"
        style={isHidden ? { opacity: 0.5 } : undefined}
        pointerEvents={isHidden ? "none" : "auto"}
      >
        <Pressable
          onPress={() => setPickerOpen((v) => !v)}
          accessibilityRole="button"
          accessibilityLabel="Go public at"
          accessibilityHint="When the event starts showing in Home, For You and search"
          className="flex-row items-center gap-3"
        >
          <View className="w-10 h-10 rounded-xl bg-muted items-center justify-center">
            <CalendarClock size={18} color={accent} />
          </View>
          <View className="flex-1">
            <Text className="text-xs text-muted-foreground mb-0.5">Go public at</Text>
            <Text className="text-sm font-semibold text-foreground">{label}</Text>
          </View>
          {publishAt ? (
            <Pressable
              onPress={() => {
                onPublishAtChange("");
                setPickerOpen(false);
              }}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Clear go-public time"
            >
              <Text style={{ color: accent, fontSize: 12, fontWeight: "600" }}>Clear</Text>
            </Pressable>
          ) : null}
        </Pressable>
        {pickerOpen ? (
          <DateTimePicker
            value={picked ?? new Date()}
            mode="datetime"
            display={Platform.OS === "ios" ? "spinner" : "default"}
            themeVariant="dark"
            style={{ width: "100%" }}
            onChange={(_, d) => {
              if (Platform.OS === "android") setPickerOpen(false);
              if (d) onPublishAtChange(d.toISOString());
            }}
          />
        ) : null}
        <Text
          style={{ color: error ? "#F87171" : muted, fontSize: 12 }}
          accessibilityRole={error ? "alert" : undefined}
        >
          {error ?? `Read in ${zoneDisplayName(eventTz)}. Not the event date.`}
        </Text>
      </View>
    </View>
  );
});
