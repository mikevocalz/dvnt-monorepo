/**
 * InCallVideoStage — FaceTime-style in-call video layout.
 *
 * - Remote video: fullscreen (cover)
 * - Local preview: small draggable bubble (top-right)
 * - Duration badge: top-center
 * - Controls: floating bottom bar (rendered by parent)
 */

import { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RTCView, RTCPIPView } from "@fishjam-cloud/react-native-client";
import type { MediaStream } from "@fishjam-cloud/react-native-webrtc";
import { Image } from "expo-image";
import { LocalPreviewBubble } from "../LocalPreviewBubble";

export interface InCallVideoStageProps {
  remoteVideoStream: MediaStream | null;
  hasRemoteVideo: boolean;
  remoteMicOn: boolean;
  localStream: MediaStream | null;
  hasLocalVideo: boolean;
  recipientName: string;
  recipientAvatar?: string;
  callDuration: number;
  pipViewRef: React.RefObject<any>;
}

function formatDuration(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function InCallVideoStage({
  remoteVideoStream,
  hasRemoteVideo,
  remoteMicOn,
  localStream,
  hasLocalVideo,
  recipientName,
  recipientAvatar,
  callDuration,
  pipViewRef,
}: InCallVideoStageProps) {
  const insets = useSafeAreaInsets();

  // Pulsing ring for speaking indicator when camera is off
  const pulseAnim = useRef(new Animated.Value(1)).current;
  useEffect(() => {
    if (!hasRemoteVideo && remoteMicOn) {
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
    } else {
      pulseAnim.setValue(1);
    }
  }, [hasRemoteVideo, remoteMicOn, pulseAnim]);

  return (
    <View style={styles.container}>
      {/* Remote video — fullscreen */}
      {hasRemoteVideo && remoteVideoStream ? (
        <RTCPIPView
          ref={pipViewRef}
          mediaStream={remoteVideoStream}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
        />
      ) : (
        // Remote video off — show avatar with speaking indicator
        <View style={styles.avatarFallback}>
          {remoteMicOn && (
            <Animated.View
              style={[styles.pulseRing, { transform: [{ scale: pulseAnim }] }]}
            />
          )}
          {recipientAvatar ? (
            <Image
              source={{ uri: recipientAvatar }}
              style={styles.avatarLarge}
            />
          ) : (
            <View style={[styles.avatarLarge, styles.avatarPlaceholder]}>
              <Text style={styles.avatarInitial}>
                {recipientName.charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={styles.avatarName}>{recipientName}</Text>
          {remoteMicOn && <Text style={styles.speakingLabel}>Speaking...</Text>}
        </View>
      )}

      {/* Local preview bubble */}
      {hasLocalVideo && localStream && (
        <LocalPreviewBubble stream={localStream} />
      )}

      {/* Duration badge */}
      {callDuration > 0 && (
        <View style={[styles.durationBadge, { top: insets.top + 8 }]}>
          <Text style={styles.durationText}>
            {formatDuration(callDuration)}
          </Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  avatarFallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000",
  },
  avatarLarge: {
    width: 100,
    height: 100,
    borderRadius: 28,
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
  avatarName: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "600",
    marginTop: 12,
  },
  durationBadge: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  durationText: {
    color: "rgba(255,255,255,0.8)",
    fontSize: 14,
    fontFamily: "monospace",
    backgroundColor: "rgba(12,12,16,0.76)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 16,
    overflow: "hidden",
  },
  pulseRing: {
    position: "absolute",
    width: 130,
    height: 130,
    borderRadius: 65,
    borderWidth: 2,
    borderColor: "rgba(62,164,229,0.4)",
  },
  speakingLabel: {
    color: "rgba(255,255,255,0.5)",
    fontSize: 14,
    marginTop: 4,
  },
});
