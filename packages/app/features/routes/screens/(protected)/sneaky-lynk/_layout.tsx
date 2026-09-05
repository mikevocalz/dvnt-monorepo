/**
 * Sneaky Lynk Layout
 *
 * No media provider: the room's transport is MoQ (`useLynkBroadcast` →
 * `react-native-moq`), whose session is owned by the room screen and scoped to
 * a per-room token. The FishjamProvider that used to wrap this stack held a
 * process-wide WebRTC context for every Sneaky Lynk screen, including the ones
 * with no media at all (create, billing).
 */

import React from "react";
import { Stack } from "expo-router";

export default function SneakyLynkLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "slide_from_right",
        contentStyle: { backgroundColor: "#000" },
      }}
    >
      <Stack.Screen name="create" />
      <Stack.Screen name="billing" />
      <Stack.Screen
        name="room/[id]"
        options={{
          gestureEnabled: false,
          animation: "fade",
        }}
      />
    </Stack>
  );
}
