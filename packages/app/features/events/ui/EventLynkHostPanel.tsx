/**
 * Host-only panel on the event's Lynk card: who is in the waiting room, and
 * the Start button that opens the room for all of them.
 *
 * The room opens only when a host presses Start (event-lynk-room). Guests who
 * arrive earlier wait and join on their own once it starts.
 */
import React, { memo } from "react";
import { View, Text, Pressable, ActivityIndicator } from "react-native";
import { Image } from "expo-image";
import { LegendList } from "@dvnt/app/components/list";
import type { EventLynkWaiter } from "@dvnt/app/lib/api/event-lynk";
import { waitingSinceLabel } from "@dvnt/app/lib/events/event-lynk";

const AVATAR = 32;
/** About four rows; the list scrolls past that instead of growing the card. */
const LIST_MAX_HEIGHT = 196;

const WaiterRow = memo(function WaiterRow({ waiter }: { waiter: EventLynkWaiter }) {
  const name = waiter.displayName || waiter.username || "Guest";
  return (
    <View className="flex-row items-center gap-3 py-1.5">
      {waiter.avatar ? (
        <Image
          source={{ uri: waiter.avatar }}
          style={{ width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 }}
          contentFit="cover"
          cachePolicy="memory-disk"
        />
      ) : (
        <View
          className="bg-secondary items-center justify-center"
          style={{ width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 }}
        >
          <Text className="text-xs font-semibold text-muted-foreground">
            {name.slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      <Text className="flex-1 text-sm text-foreground" numberOfLines={1}>
        {name}
      </Text>
      <Text className="text-xs text-muted-foreground">
        {waitingSinceLabel(waiter.joinedAt)}
      </Text>
    </View>
  );
});

export function EventLynkHostPanel({
  waiting,
  count,
  isLive,
  isStarting,
  onStart,
}: {
  waiting: EventLynkWaiter[];
  count: number;
  isLive: boolean;
  isStarting: boolean;
  onStart: () => void;
}) {
  if (isLive) return null;
  return (
    <View className="mx-4 -mt-2 mb-4 rounded-2xl bg-card px-4 py-3" testID="event-lynk-host-panel">
      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-semibold text-foreground" accessibilityLiveRegion="polite">
          {count === 0
            ? "No one waiting yet"
            : count === 1
              ? "1 person waiting"
              : `${count} people waiting`}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start the Lynk"
          accessibilityState={{ busy: isStarting, disabled: isStarting }}
          disabled={isStarting}
          onPress={onStart}
          testID="event-lynk-start"
          className="flex-row items-center gap-2 rounded-full bg-primary px-4 py-2 active:opacity-80"
        >
          {isStarting ? <ActivityIndicator size="small" color="#fff" /> : null}
          <Text className="text-sm font-semibold text-primary-foreground">
            {isStarting ? "Starting" : "Start Lynk"}
          </Text>
        </Pressable>
      </View>
      <Text className="mt-1 text-xs text-muted-foreground">
        Guests wait here until you start. Everyone waiting joins when you do.
      </Text>
      {count > 0 ? (
        <View style={{ maxHeight: LIST_MAX_HEIGHT, marginTop: 8 }}>
          <LegendList
            data={waiting}
            keyExtractor={(w) => w.userId}
            renderItem={({ item }) => <WaiterRow waiter={item} />}
            estimatedItemSize={44}
            recycleItems
          />
        </View>
      ) : null}
    </View>
  );
}
