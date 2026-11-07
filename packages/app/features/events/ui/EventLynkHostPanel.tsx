/**
 * Host-only panel on the event's Lynk card: who is in the waiting room, and
 * a bounded waiting roster. Admission remains server-authoritative.
 *
 * The room opens only when a host presses Start (event-lynk-room). Guests who
 * arrive earlier wait and join on their own once it starts.
 */
import React, { memo } from "react";
import { View, Text, Pressable, ActivityIndicator, ScrollView } from "react-native";
import { eventLynkWaitingLabel } from "./event-lynk-card-model";
import type { EventLynkWaiter } from "@dvnt/app/lib/api/event-lynk";
import { waitingSinceLabel } from "@dvnt/app/lib/events/event-lynk";

const AVATAR = 32;
/** About four rows; the list scrolls past that instead of growing the card. */
const LIST_MAX_HEIGHT = 196;

const WaiterRow = memo(function WaiterRow({ waiter }: { waiter: EventLynkWaiter }) {
  const name = "Member waiting";
  return (
    <View className="flex-row items-center gap-3 py-1.5">
      <View accessible={false} className="bg-secondary items-center justify-center" style={{ width: AVATAR, height: AVATAR, borderRadius: AVATAR / 2 }}>
        <Text className="text-xs text-muted-foreground">•</Text>
      </View>
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
  showStart = true,
}: {
  waiting: EventLynkWaiter[];
  count: number;
  isLive: boolean;
  isStarting: boolean;
  onStart: () => void;
  showStart?: boolean;
}) {
  if (isLive) return null;
  return (
    <View className="border-t border-border px-5 py-4" testID="event-lynk-host-panel">
      <View className="flex-row flex-wrap items-center justify-between gap-3">
        <Text className="text-sm font-semibold text-foreground" accessibilityLiveRegion="polite">
          {eventLynkWaitingLabel(count)}
        </Text>
        {showStart ? <Pressable
          accessibilityRole="button"
          accessibilityLabel="Start the Lynk"
          accessibilityState={{ busy: isStarting, disabled: isStarting }}
          style={{ minHeight: 44 }}
          disabled={isStarting}
          onPress={onStart}
          testID="event-lynk-start"
          className="flex-row items-center gap-2 rounded-full bg-primary px-4 py-2 active:opacity-80"
        >
          {isStarting ? <ActivityIndicator size="small" color="#fff" /> : null}
          <Text className="text-sm font-semibold text-primary-foreground">
            {isStarting ? "Starting" : "Start Lynk"}
          </Text>
        </Pressable> : null}
      </View>
      <Text className="mt-1 text-xs text-muted-foreground">
        Host-only waiting count. Identities stay private.
      </Text>
      {waiting.length > 0 ? (
        <ScrollView nestedScrollEnabled style={{ maxHeight: LIST_MAX_HEIGHT, marginTop: 12 }} accessibilityLabel="People waiting for this event Lynk">
          {waiting.map(waiter => <WaiterRow key={waiter.userId} waiter={waiter} />)}
        </ScrollView>
      ) : <Text className="mt-4 text-sm leading-5 text-muted-foreground">You can start when you’re ready. Eligible guests will arrive here before the room opens.</Text>}
    </View>
  );
}
