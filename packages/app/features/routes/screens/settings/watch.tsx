/**
 * Apple Watch settings — the phone owns the watch, so the watch's switches
 * live here. Each one is a real kill switch: flipping it off stops the push
 * AND clears what the wrist already cached (see `setWatchFeature`).
 */

import { View, Text, ScrollView, ActivityIndicator, TextInput, Platform } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { Main } from "@dvnt/app/components/ui/html";
import { useNavigation } from "expo-router";
import { useLayoutEffect } from "react";
import {
  Watch,
  Ticket,
  Megaphone,
  Phone,
  MessageCircle,
  DoorOpen,
} from "lucide-react-native";
import { SettingsCloseButton } from "@dvnt/app/components/settings-back-button";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { Switch } from "@dvnt/app/components/ui/switch";
import {
  getWatchStatus,
  setWatchFeature,
  useWatchSettingsStore,
  type WatchFeatureKey,
  type WatchStatus,
} from "@dvnt/app/features/watch";

type Row = {
  key: Exclude<WatchFeatureKey, "enabled">;
  label: string;
  detail: string;
  icon: React.ReactNode;
};

const ROWS: Row[] = [
  {
    key: "tickets",
    label: "Tickets & Door Pass",
    detail: "Your tickets and scannable QR on the wrist, offline.",
    icon: <Ticket size={20} color="#3FDCFF" />,
  },
  {
    key: "broadcasts",
    label: "Host Broadcasts",
    detail: "Tap on the wrist when a host messages the room.",
    icon: <Megaphone size={20} color="#8A40CF" />,
  },
  {
    key: "calls",
    label: "Incoming Calls",
    detail: "Ring the wrist, and answer or decline from it.",
    icon: <Phone size={20} color="#FF5BFC" />,
  },
  {
    key: "messages",
    label: "Messages",
    detail: "Conversation history, photos and replies from your watch.",
    icon: <MessageCircle size={20} color="#F5C518" />,
  },
  {
    key: "door",
    label: "Door Counts",
    detail: "Running an event? Arrived, expected and the priority lane.",
    icon: <DoorOpen size={20} color="#3FDCFF" />,
  },
];

export default function WatchSettingsScreen() {
  const navigation = useNavigation();
  const { colors } = useColorScheme();
  const enabled = useWatchSettingsStore((s) => s.enabled);
  const tickets = useWatchSettingsStore((s) => s.tickets);
  const broadcasts = useWatchSettingsStore((s) => s.broadcasts);
  const calls = useWatchSettingsStore((s) => s.calls);
  const messages = useWatchSettingsStore((s) => s.messages);
  const door = useWatchSettingsStore((s) => s.door);
  const { data: status } = useQuery({ queryKey: ["watch-status"], queryFn: getWatchStatus, refetchInterval: 10000 });
  const quickReplies = useWatchSettingsStore((s) => s.quickReplies);
  const setQuickReplies = useWatchSettingsStore((s) => s.setQuickReplies);
  const watchName = Platform.OS === "android" ? "Wear OS" : "Apple Watch";

  const values = { tickets, broadcasts, calls, messages, door };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: watchName,
      headerBackButtonDisplayMode: "minimal",
      headerLeft: () => null,
      headerTintColor: colors.foreground,
      headerStyle: { backgroundColor: colors.background },
      headerTitleStyle: {
        color: colors.foreground,
        fontWeight: "600" as const,
        fontSize: 17,
      },
      headerShadowVisible: false,
      headerRight: () => <SettingsCloseButton />,
    });
  }, [navigation, colors, watchName]);


  const toggle = (key: WatchFeatureKey, value: boolean) => {
    void setWatchFeature(key, value);
  };

  if (!status) {
    return (
      <View className="flex-1 bg-background">
        <Main className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color={colors.primary} />
        </Main>
      </View>
    );
  }

  // No watch paired: show the switches read-only rather than hiding them, so
  // the member can see what pairing would give them — but never pretend a
  // toggle is doing something when there is nothing on the other end.
  const noWatch = !status.paired;

  return (
    <View className="flex-1 bg-background">
      <Main className="flex-1">
        <ScrollView
          className="flex-1 px-4 py-6"
          showsVerticalScrollIndicator={false}
        >
          <View className="mb-6 rounded-xl border border-border bg-card">
            <View className="flex-row items-center justify-between p-4">
              <View className="flex-1 flex-row items-center gap-3 pr-4">
                <Watch size={20} color={colors.foreground} />
                <View className="flex-1">
                  <Text className="font-semibold text-foreground">
                    DVNT on {watchName}
                  </Text>
                  <Text className="mt-1 text-sm text-muted-foreground">
                    {noWatch
                      ? `No ${watchName} companion detected.`
                      : !status.appInstalled
                        ? "Paired — install DVNT from the Watch app to start."
                        : Platform.OS === "android"
                          ? "Companion detected. Delivery is confirmed when you send a request."
                        : status.reachable
                          ? "Available for watch requests."
                          : "Watch unavailable right now. Cached content stays on the wrist."}
                  </Text>
                </View>
              </View>
              <Switch
                checked={enabled}
                disabled={noWatch}
                onCheckedChange={(v) => toggle("enabled", v)}
              />
            </View>
          </View>

          <Text className="mb-3 text-sm font-semibold text-muted-foreground">
            ON THE WRIST
          </Text>
          <View className="mb-6 rounded-xl border border-border bg-card">
            {ROWS.map((row, i) => (
              <View key={row.key}>
                {i > 0 && <View className="mx-4 h-px bg-border" />}
                <View className="flex-row items-center justify-between p-4">
                  <View className="flex-1 flex-row items-center gap-3 pr-4">
                    {row.icon}
                    <View className="flex-1">
                      <Text className="font-medium text-foreground">
                        {row.label}
                      </Text>
                      <Text className="mt-0.5 text-xs text-muted-foreground">
                        {row.detail}
                      </Text>
                    </View>
                  </View>
                  <Switch
                    checked={values[row.key]}
                    disabled={noWatch || !enabled}
                    onCheckedChange={(v) => toggle(row.key, v)}
                  />
                </View>
              </View>
            ))}
          </View>

          <Text className="mb-3 text-sm font-semibold text-muted-foreground">QUICK REPLIES</Text>
          <View className="mb-6 gap-3">
            {quickReplies.map((reply, index) => (
              <TextInput key={index} value={reply} maxLength={500}
                accessibilityLabel={`Quick reply ${index + 1}`}
                onChangeText={(text) => setQuickReplies(quickReplies.map((value, i) => i === index ? text : value))}
                className="rounded-xl border border-border bg-card p-4 text-foreground" />
            ))}
            <Text className="text-sm text-muted-foreground">Choose a phrase on your watch, then confirm Send.</Text>
          </View>
          <View className="mt-2 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <Text className="text-sm text-muted-foreground">
              Turning something off sends a clear request. A disconnected watch keeps cached content until it receives that request. Calls
              use your phone for audio — the watch only ever
              carries the decision, and a reply typed on the wrist is sent by
              this iPhone. Messages starts off: anyone next to you can read your
              wrist.
            </Text>
          </View>
        </ScrollView>
      </Main>
    </View>
  );
}
