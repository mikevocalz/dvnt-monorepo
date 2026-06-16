/**
 * Video Stage Component
 * Supports single or dual (split-screen) video views for host + co-host.
 * Uses Fishjam RTCView for rendering WebRTC video tracks.
 * Speaking animation uses Reanimated shared values for smooth, battery-efficient pulsing.
 */

import React, { useEffect } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { BadgeCheck, EyeOff, Video } from "lucide-react-native";
import { RTCView } from "@fishjam-cloud/react-native-client";
import {
  Camera as VisionCamera,
  useCameraDevice,
} from "react-native-vision-camera";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
  cancelAnimation,
} from "react-native-reanimated";
import { Avatar } from "@/components/ui/avatar";
import type { SneakyUser } from "../types";
import { getSneakyUserLabel } from "./user-labels";

interface FeaturedSpeaker {
  id: string;
  user: SneakyUser;
  isSpeaking: boolean;
  hasVideo: boolean;
}

interface VideoStageProps {
  featuredSpeaker: FeaturedSpeaker | null;
  coHost?: FeaturedSpeaker | null;
  isSpeaking: boolean;
  isLocalUser?: boolean;
  isVideoEnabled?: boolean;
  videoTrack?: any;
  coHostVideoTrack?: any;
  isCoHostLocal?: boolean;
  /** Use VisionCamera for local preview (no Fishjam connection) */
  useNativeCamera?: boolean;
  onSelectSpeaker?: (userId: string) => void;
}

// ── Speaking ring animation (Reanimated) ────────────────────────────

function SpeakingRing({ isSpeaking }: { isSpeaking: boolean }) {
  const ringScale = useSharedValue(1);
  const ringOpacity = useSharedValue(0);

  useEffect(() => {
    if (isSpeaking) {
      ringScale.value = withRepeat(
        withSequence(
          withTiming(1.15, { duration: 600, easing: Easing.out(Easing.ease) }),
          withTiming(1, { duration: 600, easing: Easing.in(Easing.ease) }),
        ),
        -1,
        false,
      );
      ringOpacity.value = withRepeat(
        withSequence(
          withTiming(0.7, { duration: 600, easing: Easing.out(Easing.ease) }),
          withTiming(0.2, { duration: 600, easing: Easing.in(Easing.ease) }),
        ),
        -1,
        false,
      );
    } else {
      cancelAnimation(ringScale);
      cancelAnimation(ringOpacity);
      ringScale.value = withTiming(1, { duration: 200 });
      ringOpacity.value = withTiming(0, { duration: 200 });
    }
  }, [isSpeaking, ringScale, ringOpacity]);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ scale: ringScale.value }],
    opacity: ringOpacity.value,
  }));

  return (
    <Animated.View
      style={[
        StyleSheet.absoluteFill,
        {
          borderRadius: 20,
          borderWidth: 3,
          borderColor: "#3FDCFF",
        },
        animatedStyle,
      ]}
      pointerEvents="none"
    />
  );
}

function SoundWave() {
  return (
    <View className="flex-row items-center gap-0.5 h-4">
      <View className="w-[3px] h-1.5 bg-[#3FDCFF] rounded-sm" />
      <View className="w-[3px] h-3 bg-[#3FDCFF] rounded-sm" />
      <View className="w-[3px] h-4 bg-[#3FDCFF] rounded-sm" />
      <View className="w-[3px] h-3 bg-[#3FDCFF] rounded-sm" />
      <View className="w-[3px] h-1.5 bg-[#3FDCFF] rounded-sm" />
    </View>
  );
}

function SpeakerLabel({
  user,
  isSpeaking,
  role,
}: {
  user: SneakyUser;
  isSpeaking: boolean;
  role?: string;
}) {
  const label = getSneakyUserLabel(user);
  return (
    <>
      <LinearGradient
        colors={["transparent", "rgba(0,0,0,0.8)"]}
        style={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          height: 80,
        }}
      />
      <View
        style={{
          position: "absolute",
          bottom: 8,
          left: 8,
          right: 8,
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
        }}
      >
        {role && (
          <View
            style={{
              backgroundColor: role === "host" ? "#FC253A" : "#8A40CF",
              paddingHorizontal: 6,
              paddingVertical: 2,
              borderRadius: 6,
            }}
          >
            <Text style={{ color: "#fff", fontSize: 9, fontWeight: "700" }}>
              {role === "host" ? "HOST" : "CO-HOST"}
            </Text>
          </View>
        )}
        <Text
          style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}
          numberOfLines={1}
        >
          {label}
        </Text>
        {user.isVerified && (
          <BadgeCheck size={12} color="#FF6DC1" fill="#FF6DC1" />
        )}
      </View>
      {isSpeaking && (
        <View
          style={{
            position: "absolute",
            top: 6,
            right: 6,
            backgroundColor: "rgba(0,0,0,0.5)",
            paddingHorizontal: 8,
            paddingVertical: 4,
            borderRadius: 10,
          }}
        >
          <SoundWave />
        </View>
      )}
    </>
  );
}

// ── Radiating pulse rings for audio-only speaking indicator ──────────

function PulseRing({
  isSpeaking,
  size,
  delay,
  maxScale,
  color = "#FC253A",
}: {
  isSpeaking: boolean;
  size: number;
  delay: number;
  maxScale: number;
  color?: string;
}) {
  const scale = useSharedValue(1);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (isSpeaking) {
      scale.value = withSequence(
        withTiming(1, { duration: delay }),
        withRepeat(
          withSequence(
            withTiming(maxScale, {
              duration: 1000,
              easing: Easing.out(Easing.ease),
            }),
            withTiming(1, { duration: 1000, easing: Easing.in(Easing.ease) }),
          ),
          -1,
          false,
        ),
      );
      opacity.value = withSequence(
        withTiming(0, { duration: delay }),
        withRepeat(
          withSequence(
            withTiming(0.25, {
              duration: 500,
              easing: Easing.out(Easing.ease),
            }),
            withTiming(0, { duration: 1500, easing: Easing.in(Easing.ease) }),
          ),
          -1,
          false,
        ),
      );
    } else {
      cancelAnimation(scale);
      cancelAnimation(opacity);
      scale.value = withTiming(1, { duration: 200 });
      opacity.value = withTiming(0, { duration: 200 });
    }
  }, [isSpeaking, scale, opacity, delay, maxScale]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scale: scale.value }],
    opacity: opacity.value,
  }));

  return (
    <Animated.View
      style={[
        {
          position: "absolute",
          width: size,
          height: size,
          borderRadius: 20,
          backgroundColor: color,
          top: (100 - size) / 2,
          left: (100 - size) / 2,
        },
        animStyle,
      ]}
      pointerEvents="none"
    />
  );
}

// ── Audio-only avatar tile with speaking ring ────────────────────────

function AudioOnlyTile({
  speaker,
  role,
}: {
  speaker: FeaturedSpeaker;
  role?: string;
}) {
  const label = getSneakyUserLabel(speaker.user);
  return (
    <View
      style={{
        flex: 1,
        backgroundColor: "#1a1a1a",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <View style={{ position: "relative", width: 100, height: 100 }}>
        {/* Radiating pulse rings behind avatar */}
        <PulseRing
          isSpeaking={speaker.isSpeaking}
          size={130}
          delay={0}
          maxScale={1.12}
          color="#FC253A"
        />
        <PulseRing
          isSpeaking={speaker.isSpeaking}
          size={120}
          delay={200}
          maxScale={1.08}
          color="#FF5BFC"
        />
        <PulseRing
          isSpeaking={speaker.isSpeaking}
          size={110}
          delay={400}
          maxScale={1.05}
          color="#FC253A"
        />
        {speaker.user.isAnonymous ? (
          <View
            style={[
              {
                width: 100,
                height: 100,
                borderRadius: 24,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: "rgba(255,255,255,0.08)",
              },
              speaker.isSpeaking
                ? { borderColor: "#3FDCFF", borderWidth: 3 }
                : null,
            ]}
          >
            <EyeOff size={28} color="#94A3B8" />
          </View>
        ) : (
          <Avatar
            uri={speaker.user.avatar}
            username={speaker.user.username}
            size={100}
            variant="roundedSquare"
            style={
              speaker.isSpeaking
                ? { borderColor: "#3FDCFF", borderWidth: 3 }
                : undefined
            }
          />
        )}
      </View>
      <Text
        style={{
          color: "#fff",
          fontSize: 14,
          fontWeight: "600",
          marginTop: 10,
        }}
      >
        {label}
      </Text>
      {role && (
        <View
          style={{
            backgroundColor: role === "host" ? "#FC253A" : "#8A40CF",
            paddingHorizontal: 8,
            paddingVertical: 2,
            borderRadius: 8,
            marginTop: 4,
          }}
        >
          <Text style={{ color: "#fff", fontSize: 10, fontWeight: "700" }}>
            {role === "host" ? "HOST" : "CO-HOST"}
          </Text>
        </View>
      )}
    </View>
  );
}

function VideoPanel({
  speaker,
  videoTrack,
  isLocal,
  style,
  role,
  useNativeCamera,
}: {
  speaker: FeaturedSpeaker;
  videoTrack?: any;
  isLocal?: boolean;
  style?: any;
  role?: string;
  useNativeCamera?: boolean;
}) {
  const hasStream = videoTrack?.stream;
  const frontDevice = useCameraDevice("front");
  const showVideo =
    speaker.hasVideo && (hasStream || (useNativeCamera && isLocal));

  if (!showVideo) {
    // Audio-only: show avatar with speaking ring
    return (
      <View style={[{ overflow: "hidden", backgroundColor: "#1a1a1a" }, style]}>
        <AudioOnlyTile speaker={speaker} role={role} />
      </View>
    );
  }

  // Determine what to render for video
  const renderVideo = () => {
    // VisionCamera preview — for local rooms without Fishjam connection
    if (useNativeCamera && isLocal && frontDevice) {
      return (
        <VisionCamera
          style={StyleSheet.absoluteFill}
          device={frontDevice}
          isActive={true}
        />
      );
    }
    // Fishjam RTCView — for server-backed rooms with WebRTC streams
    if (hasStream) {
      return (
        <RTCView
          mediaStream={videoTrack.stream}
          style={StyleSheet.absoluteFill}
          objectFit="cover"
          mirror={isLocal}
        />
      );
    }
    return null;
  };

  return (
    <View style={[{ overflow: "hidden", backgroundColor: "#1a1a1a" }, style]}>
      {renderVideo()}
      {/* Speaking ring overlay on video */}
      <SpeakingRing isSpeaking={speaker.isSpeaking} />
      <SpeakerLabel
        user={speaker.user}
        isSpeaking={speaker.isSpeaking}
        role={role}
      />
      <View
        style={{
          position: "absolute",
          top: 6,
          left: 6,
          backgroundColor: "rgba(0,0,0,0.5)",
          padding: 4,
          borderRadius: 6,
        }}
      >
        <Video size={12} color="#fff" />
      </View>
    </View>
  );
}

export function VideoStage({
  featuredSpeaker,
  coHost,
  isSpeaking,
  isLocalUser = false,
  isVideoEnabled = false,
  videoTrack,
  coHostVideoTrack,
  isCoHostLocal = false,
  useNativeCamera = false,
  onSelectSpeaker,
}: VideoStageProps) {
  if (!featuredSpeaker) return null;

  const isDual = !!coHost;

  // Dual view: host and co-host side by side
  if (isDual) {
    return (
      <View className="px-4 mb-5">
        <View
          style={{
            flexDirection: "row",
            height: 220,
            borderRadius: 20,
            overflow: "hidden",
            gap: 3,
          }}
        >
          <Pressable
            style={{ flex: 1 }}
            onPress={() => onSelectSpeaker?.(featuredSpeaker.user.id)}
          >
            <VideoPanel
              speaker={featuredSpeaker}
              videoTrack={isVideoEnabled ? videoTrack : undefined}
              isLocal={isLocalUser}
              useNativeCamera={useNativeCamera}
              style={{
                flex: 1,
                borderTopLeftRadius: 20,
                borderBottomLeftRadius: 20,
              }}
              role="host"
            />
          </Pressable>
          <Pressable
            style={{ flex: 1 }}
            onPress={() => onSelectSpeaker?.(coHost.user.id)}
          >
            <VideoPanel
              speaker={coHost}
              videoTrack={coHostVideoTrack}
              isLocal={isCoHostLocal}
              style={{
                flex: 1,
                borderTopRightRadius: 20,
                borderBottomRightRadius: 20,
              }}
              role="co-host"
            />
          </Pressable>
        </View>
      </View>
    );
  }

  // Single view: just the featured speaker
  const hasVideoStream = isVideoEnabled && videoTrack?.stream;
  const showNativeCamera = useNativeCamera && isLocalUser && isVideoEnabled;
  const showVideo = isVideoEnabled && (hasVideoStream || showNativeCamera);
  const frontDevice = useCameraDevice("front");

  // Audio-only: large avatar tile with speaking ring
  if (!showVideo) {
    return (
      <View className="px-4 mb-5">
        <Pressable
          onPress={() => onSelectSpeaker?.(featuredSpeaker.user.id)}
          style={{
            width: "100%",
            height: 220,
            borderRadius: 20,
            overflow: "hidden",
            backgroundColor: "#1a1a1a",
          }}
        >
          <AudioOnlyTile speaker={featuredSpeaker} role="host" />
          {isSpeaking && (
            <View
              style={{
                position: "absolute",
                top: 12,
                right: 12,
                backgroundColor: "rgba(0,0,0,0.5)",
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 12,
              }}
            >
              <SoundWave />
            </View>
          )}
        </Pressable>
      </View>
    );
  }

  // Video view
  return (
    <View className="px-4 mb-5">
      <Pressable
        onPress={() => onSelectSpeaker?.(featuredSpeaker.user.id)}
        style={{
          width: "100%",
          height: 220,
          borderRadius: 20,
          overflow: "hidden",
          backgroundColor: "#1a1a1a",
          position: "relative",
        }}
      >
        {showNativeCamera && frontDevice ? (
          <VisionCamera
            style={StyleSheet.absoluteFill}
            device={frontDevice}
            isActive={true}
          />
        ) : hasVideoStream ? (
          <RTCView
            mediaStream={videoTrack.stream}
            style={StyleSheet.absoluteFill}
            objectFit="cover"
            mirror={isLocalUser}
          />
        ) : null}

        {/* Speaking ring overlay */}
        <SpeakingRing isSpeaking={isSpeaking} />

        <LinearGradient
          colors={["transparent", "rgba(0,0,0,0.8)"]}
          style={{
            position: "absolute",
            bottom: 0,
            left: 0,
            right: 0,
            height: 100,
          }}
        />

        <View
          style={{
            position: "absolute",
            bottom: 16,
            left: 16,
            flexDirection: "row",
            alignItems: "center",
            gap: 10,
          }}
        >
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              backgroundColor: "#FC253A",
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 6,
              gap: 4,
            }}
          >
            <View
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                backgroundColor: "#fff",
              }}
            />
            <Text style={{ fontSize: 10, fontWeight: "700", color: "#fff" }}>
              LIVE
            </Text>
          </View>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            <Text style={{ fontSize: 14, fontWeight: "600", color: "#fff" }}>
              {getSneakyUserLabel(featuredSpeaker.user)}
            </Text>
            {featuredSpeaker.user.isVerified && (
              <BadgeCheck size={14} color="#FF6DC1" fill="#FF6DC1" />
            )}
          </View>
        </View>

        {isSpeaking && (
          <View
            style={{
              position: "absolute",
              top: 16,
              right: 16,
              backgroundColor: "rgba(0,0,0,0.5)",
              paddingHorizontal: 10,
              paddingVertical: 6,
              borderRadius: 12,
            }}
          >
            <SoundWave />
          </View>
        )}

        <View
          style={{
            position: "absolute",
            top: 16,
            left: 16,
            backgroundColor: "rgba(0,0,0,0.5)",
            padding: 6,
            borderRadius: 8,
          }}
        >
          <Video size={14} color="#fff" />
        </View>
      </Pressable>
    </View>
  );
}
