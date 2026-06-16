import { useCallback, useState } from "react";
import { ScrollView, View, Text, Pressable } from "react-native";
import { useFocusEffect } from "expo-router";
import { AppTrace, type AppTraceEvent } from "@dvnt/app/lib/diagnostics/app-trace";

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatContext(ctx: AppTraceEvent["ctx"]): string {
  const entries = Object.entries(ctx);
  if (entries.length === 0) return "no context";

  return entries.map(([key, value]) => `${key}: ${String(value)}`).join(" | ");
}

export default function TelemetryPreviewScreen() {
  const [events, setEvents] = useState<AppTraceEvent[]>([]);

  const refresh = useCallback(() => {
    const nextEvents = AppTrace.dump().slice(-80).reverse();
    setEvents(nextEvents);
  }, []);

  const clear = useCallback(() => {
    AppTrace.clear();
    refresh();
  }, [refresh]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  return (
    <View className="flex-1 bg-black">
      <View className="px-4 pt-16 pb-4 flex-row items-center justify-between border-b border-white/10">
        <View className="gap-1">
          <Text className="text-white text-2xl font-bold">App Trace</Text>
          <Text className="text-zinc-400 text-sm">
            Last {events.length} persisted funnel + crash events
          </Text>
        </View>
        <View className="flex-row gap-2">
          <Pressable
            onPress={refresh}
            className="min-h-11 px-4 rounded-2xl bg-white/10 items-center justify-center"
          >
            <Text className="text-white font-semibold">Refresh</Text>
          </Pressable>
          <Pressable
            onPress={clear}
            className="min-h-11 px-4 rounded-2xl bg-[#34A2DF] items-center justify-center"
          >
            <Text className="text-white font-semibold">Clear</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }}
      >
        {events.length === 0 ? (
          <View className="rounded-3xl border border-white/10 bg-white/5 p-4">
            <Text className="text-white font-semibold">No events yet</Text>
            <Text className="text-zinc-400 mt-2 leading-5">
              Trigger signup, verification, posting, recovery, or a public gate,
              then come back here.
            </Text>
          </View>
        ) : (
          events.map((event, index) => (
            <View
              key={`${event.ts}-${event.tag}-${event.event}-${index}`}
              className="rounded-3xl border border-white/10 bg-white/5 p-4 gap-2"
            >
              <View className="flex-row items-center justify-between">
                <Text className="text-white font-bold">
                  {event.tag} · {event.event}
                </Text>
                <Text className="text-zinc-500 text-xs">
                  {formatTimestamp(event.ts)}
                </Text>
              </View>
              <Text
                className={
                  event.level === "error"
                    ? "text-red-400 text-xs uppercase tracking-[1px]"
                    : event.level === "warn"
                      ? "text-yellow-300 text-xs uppercase tracking-[1px]"
                      : "text-[#34A2DF] text-xs uppercase tracking-[1px]"
                }
              >
                {event.level}
              </Text>
              <Text className="text-zinc-300 text-sm leading-5">
                {formatContext(event.ctx)}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
