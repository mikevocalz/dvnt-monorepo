/**
 * InCallAudioStage — In-call layout for audio-only calls.
 *
 * - Big avatar + name centered
 * - Duration timer
 * - Subtle waveform placeholder (pulsing ring)
 * - Controls: floating bottom bar (rendered by parent)
 */

import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { Image } from "expo-image";

export interface InCallAudioStageProps {
  recipientName: string;
  recipientAvatar?: string;
  callDuration: number;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function InCallAudioStage({
  recipientName,
  recipientAvatar,
  callDuration,
}: InCallAudioStageProps) {
  // Pulsing ring animation as waveform placeholder
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.15,
          duration: 1200,
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulseAnim]);

  return (
    <View style={styles.container}>
      <View style={styles.center}>
        {/* Pulsing ring behind avatar */}
        <Animated.View
          style={[
            styles.pulseRing,
            { transform: [{ scale: pulseAnim }] },
          ]}
        />

        <View style={styles.identityCard}>
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

          {callDuration > 0 && (
            <Text style={styles.duration}>{formatDuration(callDuration)}</Text>
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
  center: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
  },
  identityCard: {
    alignItems: "center",
    gap: 12,
    borderRadius: 32,
    paddingHorizontal: 28,
    paddingVertical: 28,
    backgroundColor: "rgba(12,12,16,0.72)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    minWidth: 250,
  },
  pulseRing: {
    position: "absolute",
    width: 170,
    height: 170,
    borderRadius: 48,
    borderWidth: 2,
    borderColor: "rgba(62,164,229,0.3)",
  },
  avatar: {
    width: 120,
    height: 120,
    borderRadius: 28,
  },
  avatarPlaceholder: {
    backgroundColor: "#333",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarInitial: {
    color: "#fff",
    fontSize: 44,
    fontWeight: "700",
  },
  name: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "600",
  },
  duration: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 15,
    fontFamily: "monospace",
  },
});
