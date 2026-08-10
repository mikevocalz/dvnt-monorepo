/**
 * Apple Watch settings — the phone owns the watch, so the watch's switches
 * live here. Each one is a real kill switch: flipping it off stops the push
 * AND clears what the wrist already cached (see `setWatchFeature`).
 */

import { View, Text, ScrollView, ActivityIndicator } from "react-native";
import { Main } from "@expo/html-elements";
import { useNavigation } from "expo-router";
import { useLayoutEffect, useEffect, useState } from "react";
import { Watch, Ticket, Megaphone, Phone } from "lucide-react-native";
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
];

export default function WatchSettingsScreen() {
  const navigation = useNavigation();
  const { colors } = useColorScheme();
  const enabled = useWatchSettingsStore((s) => s.enabled);
  const tickets = useWatchSettingsStore((s) => s.tickets);
  const broadcasts = useWatchSettingsStore((s) => s.broadcasts);
  const calls = useWatchSettingsStore((s) => s.calls);
  const [status, setStatus] = useState<WatchStatus | null>(null);

  const values = { tickets, broadcasts, calls };

  useLayoutEffect(() => {
    navigation.setOptions({
      headerShown: true,
      title: "Apple Watch",
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
  }, [navigation, colors]);

  useEffect(() => {
    let alive = true;
    void getWatchStatus().then((s) => {
      if (alive) setStatus(s);
    });
    return () => {
      alive = false;
    };
  }, []);

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
                    DVNT on Apple Watch
                  </Text>
                  <Text className="mt-1 text-sm text-muted-foreground">
                    {noWatch
                      ? "No Apple Watch paired with this iPhone."
                      : !status.appInstalled
                        ? "Paired — install DVNT from the Watch app to start."
                        : status.reachable
                          ? "Paired and connected."
                          : "Paired. Out of range — changes sync when it is back."}
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

          <View className="mt-2 rounded-xl border border-primary/20 bg-primary/5 p-4">
            <Text className="text-sm text-muted-foreground">
              Turning something off clears it from the watch straight away. Calls
              are still answered on this iPhone either way — the watch only ever
              carries the decision.
            </Text>
          </View>
        </ScrollView>
      </Main>
    </View>
  );
}
