/**
 * CallerRingingStage — Shown to the CALLER while waiting for callee to answer.
 *
 * FaceTime-style:
 * - Video mode: fullscreen local camera preview as background
 * - Audio mode: dark background
 * - Center: single avatar + name + "Ringing…" (NO duplicates)
 * - Controls rendered by parent (CallControls)
 */

import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RTCView } from "@fishjam-cloud/react-native-client";
import type { MediaStream } from "@fishjam-cloud/react-native-webrtc";
import { Image } from "expo-image";
import { Phone } from "lucide-react-native";

export interface CallerRingingStageProps {
  recipientName: string;
  recipientAvatar?: string;
  localStream: MediaStream | null;
  hasLocalVideo: boolean;
  isAudioMode: boolean;
  statusLabel: string;
}

export function CallerRingingStage({
  recipientName,
  recipientAvatar,
  localStream,
  hasLocalVideo,
  isAudioMode,
  statusLabel,
}: CallerRingingStageProps) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.container}>
      {/* Background: local camera preview (video) or dark gradient (audio) */}
      {!isAudioMode && hasLocalVideo && localStream ? (
        <RTCView
          mediaStream={localStream}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
          mirror={true}
        />
      ) : null}

      {/* Dark overlay for readability */}
      <View style={[StyleSheet.absoluteFill, styles.overlay]} />

      {/* Single identity card — centered */}
      <View style={[styles.identityCard, { paddingTop: insets.top + 60 }]}>
        <View style={styles.identitySurface}>
          {recipientAvatar ? (
            <Image source={{ uri: recipientAvatar }} style={styles.avatar} />
          ) : (
            <View style={[styles.avatar, styles.avatarPlaceholder]}>
              <Text style={styles.avatarInitial}>
                {recipientName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}

          <Text style={styles.name}>{recipientName}</Text>

          <View style={styles.statusRow}>
            <ActivityIndicator size="small" color="rgba(255,255,255,0.8)" />
            <Text style={styles.statusText}>{statusLabel}</Text>
          </View>

          {isAudioMode && (
            <View style={styles.audioIcon}>
              <Phone size={20} color="rgba(255,255,255,0.4)" />
            </View>
          )}
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
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  identityCard: {
    flex: 1,
    alignItems: "center",
    paddingTop: 120,
  },
  identitySurface: {
    alignItems: "center",
    borderRadius: 32,
    paddingHorizontal: 28,
    paddingVertical: 28,
    backgroundColor: "rgba(11,11,14,0.56)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    minWidth: 250,
  },
  avatar: {
    width: 100,
    height: 100,
    borderRadius: 28,
    marginBottom: 16,
  },
  avatarPlaceholder: {
    backgroundColor: "#333",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: "#fff",
    fontSize: 40,
    fontWeight: "700",
  },
  name: {
    color: "#fff",
    fontSize: 24,
    fontWeight: "600",
    marginBottom: 8,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  statusText: {
    color: "rgba(255,255,255,0.7)",
    fontSize: 16,
  },
  audioIcon: {
    marginTop: 16,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.08)",
  },
});
