/**
 * Video Chat Layout
 * Wraps video screens with FishjamProvider
 */

import React from "react";
import { Stack } from "expo-router";
import { FishjamProvider } from "@fishjam-cloud/react-native-client";
import { resolveFishjamAppId } from "@dvnt/app/lib/video/fishjam-config";

const FISHJAM_APP_ID = resolveFishjamAppId();

export default function VideoLayout() {
  return (
    <FishjamProvider fishjamId={FISHJAM_APP_ID}>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "slide_from_right",
          contentStyle: { backgroundColor: "rgb(var(--background))" },
        }}
      >
        <Stack.Screen name="rooms" />
        <Stack.Screen
          name="room/[id]"
          options={{
            gestureEnabled: false,
            animation: "fade",
          }}
        />
      </Stack>
    </FishjamProvider>
  );
}
