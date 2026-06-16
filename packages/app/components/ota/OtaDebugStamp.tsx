/**
 * OtaDebugStamp
 * Shows current bundle info so QA can confirm OTA updates are applying.
 * Only visible when EXPO_PUBLIC_FORCE_OTA_CHECK=true (dev QA mode).
 * All values come from expo-updates JS module — fully OTA-safe.
 */
import React from "react";
import { View, Text, Platform } from "react-native";

const FORCE_OTA_IN_DEV =
  typeof process !== "undefined" &&
  process.env?.EXPO_PUBLIC_FORCE_OTA_CHECK === "true";

let Updates: typeof import("expo-updates") | null = null;
if (Platform.OS !== "web") {
  try {
    Updates = require("expo-updates");
  } catch {}
}

function shortId(id: string | null | undefined): string {
  if (!id) return "none";
  return id.replace(/-/g, "").slice(0, 8);
}

export function OtaDebugStamp() {
  if (!FORCE_OTA_IN_DEV && !__DEV__) return null;
  if (!Updates) return null;

  const isEnabled = Updates.isEnabled ?? false;
  const isEmbedded = Updates.isEmbeddedLaunch ?? true;
  const updateId = shortId((Updates as any).updateId ?? null);
  const channel = (Updates as any).channel ?? "?";
  const runtimeVersion = (Updates as any).runtimeVersion ?? "?";

  return (
    <View
      pointerEvents="none"
      style={{
        position: "absolute",
        top: 60,
        right: 8,
        backgroundColor: "rgba(0,0,0,0.75)",
        borderRadius: 6,
        paddingHorizontal: 8,
        paddingVertical: 4,
        zIndex: 99998,
      }}
    >
      <Text style={{ color: isEmbedded ? "#f87171" : "#4ade80", fontSize: 9, fontFamily: "monospace" }}>
        {isEmbedded ? "EMBEDDED" : "OTA"} {updateId}
      </Text>
      <Text style={{ color: "#a1a1aa", fontSize: 9, fontFamily: "monospace" }}>
        ch:{channel} rv:{runtimeVersion}
      </Text>
      <Text style={{ color: "#a1a1aa", fontSize: 9, fontFamily: "monospace" }}>
        enabled:{String(isEnabled)}
      </Text>
    </View>
  );
}
