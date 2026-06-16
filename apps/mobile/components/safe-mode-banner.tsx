/**
 * Safe Mode Recovery Banner
 *
 * Shown when the boot guard detects repeated startup crashes and enters safe mode.
 * Informs the user that caches were cleared and the app is running in a degraded state.
 * Provides a dismiss button and a "Report Issue" placeholder.
 */

import { useState } from "react";
import { View, Text, Pressable, Linking } from "react-native";
import { getBootDiagnostics } from "@/lib/boot-guard";

export function SafeModeBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  const diag = getBootDiagnostics();

  return (
    <View
      style={{
        position: "absolute",
        top: 60,
        left: 16,
        right: 16,
        backgroundColor: "#1a1a2e",
        borderRadius: 12,
        borderWidth: 1,
        borderColor: "#e63946",
        padding: 16,
        zIndex: 99999,
        shadowColor: "#e63946",
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.3,
        shadowRadius: 8,
        elevation: 10,
      }}
    >
      <Text
        style={{
          color: "#e63946",
          fontSize: 15,
          fontWeight: "700",
          marginBottom: 6,
        }}
      >
        Safe Mode Active
      </Text>
      <Text style={{ color: "#a1a1aa", fontSize: 13, lineHeight: 18 }}>
        DVNT detected {diag.consecutiveFailedBoots} failed startups and cleared
        cached data to recover. Some content may reload.
      </Text>
      <View
        style={{
          flexDirection: "row",
          marginTop: 12,
          gap: 10,
        }}
      >
        <Pressable
          onPress={() => setDismissed(true)}
          style={{
            flex: 1,
            paddingVertical: 10,
            borderRadius: 8,
            backgroundColor: "#262626",
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>
            Dismiss
          </Text>
        </Pressable>
        <Pressable
          onPress={() => {
            Linking.openURL("mailto:support@dvnt.app?subject=DVNT%20Safe%20Mode%20Report");
          }}
          style={{
            flex: 1,
            paddingVertical: 10,
            borderRadius: 8,
            backgroundColor: "#e63946",
            alignItems: "center",
          }}
        >
          <Text style={{ color: "#fff", fontSize: 13, fontWeight: "600" }}>
            Report Issue
          </Text>
        </Pressable>
      </View>
    </View>
  );
}
