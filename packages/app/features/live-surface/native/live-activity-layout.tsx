/**
 * DVNT Live Surface — Live Activity layout (expo-widgets).
 *
 * This function is marked with the `"widget"` directive so babel-preset-expo's
 * widgets plugin compiles it for the WidgetKit runtime. It renders the Lock
 * Screen banner + Dynamic Island presentations from the live-surface payload
 * using `@expo/ui/swift-ui`. It is required lazily (iOS-only) by ios-bridge.ts
 * so this SwiftUI import never reaches the web/Android bundle.
 *
 * NOTE: This is the minimal, compile-clean baseline layout for the WS-1 adapter
 * migration. Rich per-tile widget UI (QR ticket, host pulse, etc.) is the
 * separate widgets-portfolio work (baseline §3) and is device/EAS-gated.
 */
import { HStack, Text, VStack } from "@expo/ui/swift-ui";

import type { LiveActivityEnvironment, LiveActivityLayout } from "expo-widgets";

import type { LiveSurfacePayload } from "../types";

export function liveSurfaceLayout(
  props: LiveSurfacePayload,
  _environment: LiveActivityEnvironment,
): LiveActivityLayout {
  "widget";

  const title = props.tile1?.title ?? "DVNT";
  const venue = props.tile1?.venueName ?? props.tile1?.city ?? "";
  const temp =
    props.weather?.tempF != null ? `${Math.round(props.weather.tempF)}°` : "";

  return {
    banner: (
      <VStack alignment="leading" spacing={2}>
        <Text>{title}</Text>
        {venue ? <Text>{venue}</Text> : null}
      </VStack>
    ),
    compactLeading: <Text>DVNT</Text>,
    compactTrailing: <Text>{temp}</Text>,
    minimal: <Text>D</Text>,
    expandedLeading: <Text>{title}</Text>,
    expandedTrailing: <Text>{temp}</Text>,
    expandedCenter: (
      <HStack spacing={6}>
        <Text>{venue}</Text>
      </HStack>
    ),
  };
}
