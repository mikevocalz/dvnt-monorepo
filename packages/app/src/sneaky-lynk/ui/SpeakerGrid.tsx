/**
 * Speaker Grid Component
 * Grid of speakers with animated pulsing rings for active speakers
 */

import { View, Text, Pressable, Animated, Easing } from "react-native";
import { Image } from "expo-image";
import { BadgeCheck, EyeOff, MicOff } from "lucide-react-native";
import { useEffect, useRef, useCallback } from "react";
import type { SneakyUser, MemberRole } from "../types";
import { getSneakyUserHandle, getSneakyUserLabel } from "./user-labels";

interface Speaker {
  id: string;
  user: SneakyUser;
  role: MemberRole;
  isSpeaking: boolean;
}

interface SpeakerGridProps {
  speakers: Speaker[];
  activeSpeakers: Set<string>;
  isLocalHost?: boolean;
  onMuteCoHost?: () => void;
}

interface SpeakerCardProps {
  speaker: Speaker;
  isActive: boolean;
  isHost: boolean;
  showMuteButton?: boolean;
  onMute?: () => void;
}

function SpeakerCard({
  speaker,
  isActive,
  isHost,
  showMuteButton,
  onMute,
}: SpeakerCardProps) {
  const pulseAnim = useRef(new Animated.Value(0)).current;
  const scaleAnim = useRef(new Animated.Value(1)).current;
  const label = getSneakyUserLabel(speaker.user);
  const handle = getSneakyUserHandle(speaker.user);

  const startAnimation = useCallback(() => {
    const pulseAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 600,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 0,
          duration: 600,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    const scaleAnimation = Animated.loop(
      Animated.sequence([
        Animated.timing(scaleAnim, {
          toValue: 1.08,
          duration: 400,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(scaleAnim, {
          toValue: 1,
          duration: 400,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );

    pulseAnimation.start();
    scaleAnimation.start();
  }, [pulseAnim, scaleAnim]);

  const stopAnimation = useCallback(() => {
    pulseAnim.stopAnimation();
    scaleAnim.stopAnimation();
    Animated.parallel([
      Animated.timing(pulseAnim, {
        toValue: 0,
        duration: 200,
        useNativeDriver: true,
      }),
      Animated.timing(scaleAnim, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }),
    ]).start();
  }, [pulseAnim, scaleAnim]);

  useEffect(() => {
    if (isActive) {
      startAnimation();
    } else {
      stopAnimation();
    }
    return () => stopAnimation();
  }, [isActive, startAnimation, stopAnimation]);

  const pulseOpacityOuter = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.6, 0],
  });

  const pulseScaleOuter = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.5],
  });

  const pulseOpacityInner = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [0.4, 0],
  });

  const pulseScaleInner = pulseAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [1, 1.3],
  });

  return (
    <View className="items-center w-[100px]">
      <View className="relative mb-2.5 w-20 h-20 items-center justify-center">
        {/* Pulse rings */}
        {isActive && (
          <>
            <Animated.View
              className="absolute w-[72px] h-[72px] rounded-2xl border-[3px] border-[#3FDCFF]"
              style={{
                opacity: pulseOpacityOuter,
                transform: [{ scale: pulseScaleOuter }],
              }}
            />
            <Animated.View
              className="absolute w-[72px] h-[72px] rounded-2xl border-[3px] border-primary"
              style={{
                opacity: pulseOpacityInner,
                transform: [{ scale: pulseScaleInner }],
              }}
            />
          </>
        )}

        {/* Avatar — rounded square */}
        <Animated.View
          className="w-[72px] h-[72px] rounded-2xl"
          style={{ transform: [{ scale: isActive ? scaleAnim : 1 }] }}
        >
          {speaker.user.isAnonymous ? (
            <View
              className={`w-[72px] h-[72px] rounded-2xl border-[3px] items-center justify-center ${
                isActive ? "border-[#3FDCFF]" : "border-secondary"
              }`}
              style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
            >
              <EyeOff size={24} color="#94A3B8" />
            </View>
          ) : (
            <Image
              source={{ uri: speaker.user.avatar }}
              className={`w-[72px] h-[72px] rounded-2xl border-[3px] ${
                isActive ? "border-[#3FDCFF]" : "border-secondary"
              }`}
            />
          )}
        </Animated.View>

        {/* Host badge */}
        {isHost && (
          <View className="absolute -top-1 -right-1 bg-primary px-2 py-0.5 rounded-[10px]">
            <Text className="text-[10px] font-bold text-white">Host</Text>
          </View>
        )}

        {/* Speaking indicator */}
        <View
          className={`absolute -bottom-0.5 -right-0.5 w-[18px] h-[18px] rounded-full border-[3px] border-background ${
            isActive ? "bg-[#3FDCFF]" : "bg-muted-foreground"
          }`}
        />

        {/* Mute button — host can mute co-host */}
        {showMuteButton && onMute && (
          <Pressable
            onPress={onMute}
            hitSlop={8}
            className="absolute -bottom-1 -left-1 w-6 h-6 rounded-full bg-red-500 items-center justify-center"
            style={{ borderWidth: 2, borderColor: "#000" }}
          >
            <MicOff size={12} color="#fff" />
          </Pressable>
        )}
      </View>

      {/* Name */}
      <View className="flex-row items-center gap-1">
        <Text
          className="text-sm font-semibold text-foreground max-w-[80px]"
          numberOfLines={1}
        >
          {label}
        </Text>
        {speaker.user.isVerified && (
          <BadgeCheck size={12} color="#FF6DC1" fill="#FF6DC1" />
        )}
      </View>

      {handle ? (
        <Text className="text-xs text-muted-foreground mt-0.5">@{handle}</Text>
      ) : null}
    </View>
  );
}

export function SpeakerGrid({
  speakers,
  activeSpeakers,
  isLocalHost,
  onMuteCoHost,
}: SpeakerGridProps) {
  return (
    <View className="px-5 mb-6">
      <Text className="text-base font-bold text-foreground mb-4">Speakers</Text>
      <View className="flex-row flex-wrap gap-4 justify-center">
        {speakers.map((speaker, index) => (
          <SpeakerCard
            key={speaker.id}
            speaker={speaker}
            isActive={activeSpeakers.has(speaker.user.id)}
            isHost={index === 0 || speaker.role === "host"}
            showMuteButton={isLocalHost && speaker.role === "co-host"}
            onMute={onMuteCoHost}
          />
        ))}
      </View>
    </View>
  );
}
