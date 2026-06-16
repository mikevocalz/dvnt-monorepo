/**
 * ReceiverConnectingStage — Shown to the CALLEE after accepting, before fully joined.
 *
 * FaceTime-style:
 * - Background: local camera preview (video) or dark (audio)
 * - Center: "Connecting…" text
 * - Controls: End only (rendered by parent)
 */

import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RTCView } from "@fishjam-cloud/react-native-client";
import type { MediaStream } from "@fishjam-cloud/react-native-webrtc";

export interface ReceiverConnectingStageProps {
  localStream: MediaStream | null;
  hasLocalVideo: boolean;
  isAudioMode: boolean;
}

export function ReceiverConnectingStage({
  localStream,
  hasLocalVideo,
  isAudioMode,
}: ReceiverConnectingStageProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      {!isAudioMode && hasLocalVideo && localStream ? (
        <RTCView
          mediaStream={localStream}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
          mirror={true}
        />
      ) : null}

      <View style={[StyleSheet.absoluteFill, styles.overlay]} />

      <View style={[styles.center, { paddingTop: insets.top + 80 }]}>
        <View style={styles.card}>
          <ActivityIndicator size="large" color="rgba(255,255,255,0.8)" />
          <Text style={styles.text}>Connecting…</Text>
          <Text style={styles.subtext}>
            Preparing audio and video for this room.
          </Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  overlay: {
    backgroundColor: "rgba(0,0,0,0.35)",
  },
  center: {
    flex: 1,
    alignItems: "center",
    paddingTop: 160,
    gap: 16,
  },
  card: {
    borderRadius: 28,
    paddingHorizontal: 24,
    paddingVertical: 24,
    alignItems: "center",
    gap: 12,
    backgroundColor: "rgba(11,11,14,0.58)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
  },
  text: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 20,
    fontWeight: "500",
  },
  subtext: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 14,
  },
});
