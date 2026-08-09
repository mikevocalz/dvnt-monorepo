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
          // Was "rgb(var(--background))" — CSS syntax in a plain RN style
          // object, which RN cannot parse, so it fell back to the theme.
          contentStyle: { backgroundColor: "#000" },
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
