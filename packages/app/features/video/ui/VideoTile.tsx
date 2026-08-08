/**
 * VideoTile Component
 * Displays a participant's video stream with overlay info
 */

import React from "react";
import { View, Text, Pressable } from "react-native";
import { RTCView } from "@fishjam-cloud/react-native-client";
import { Image } from "expo-image";
import {
  Mic,
  MicOff,
  Video,
  VideoOff,
  Crown,
  Shield,
} from "lucide-react-native";
import { c, colors } from "./styles";
import type { Participant, MemberRole } from "../types";

interface VideoTileProps {
  participant: Participant;
  isLarge?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}

export function VideoTile({
  participant,
  isLarge = false,
  onPress,
  onLongPress,
}: VideoTileProps) {
  const {
    username,
    displayName,
    avatar,
    role,
    isCameraOn,
    isMicOn,
    isLocal,
    videoTrack,
    isAnonymous,
    anonLabel,
  } = participant;

  const resolvedName = anonLabel || username || displayName || "Guest";
  const initials = resolvedName.slice(0, 2).toUpperCase();

  return (
    <Pressable
      className={isLarge ? c.videoTileLarge : c.videoTileSmall}
      onPress={onPress}
      onLongPress={onLongPress}
      style={isLarge ? { aspectRatio: 16 / 9 } : undefined}
    >
      {/* Video Stream or Avatar Fallback */}
      {isCameraOn && videoTrack?.stream ? (
        <RTCView
          // @ts-expect-error - RTCView types may vary between versions
          stream={videoTrack.stream}
          style={{ flex: 1 }}
          objectFit="cover"
          mirror={isLocal}
        />
      ) : (
        <View className="flex-1 items-center justify-center bg-muted">
          {avatar && !isAnonymous ? (
            <Image
              source={{ uri: avatar }}
              className={isLarge ? c.avatarXl : c.avatarLg}
              contentFit="cover"
            />
          ) : (
            <View
              className={`${isLarge ? c.avatarXl : c.avatarLg} items-center justify-center bg-primary/20`}
            >
              <Text className="text-xl font-bold text-primary">{initials}</Text>
            </View>
          )}
        </View>
      )}

      {/* Bottom Overlay */}
      <View className={c.videoOverlay}>
        <View className="flex-row items-center justify-between">
          {/* Name & Role Badge */}
          <View className="flex-row items-center gap-2 flex-1">
            <View className={c.videoNamePill}>
              <Text
                className="text-white text-xs font-medium"
                numberOfLines={1}
              >
                {resolvedName}
              </Text>
            </View>
            <RoleBadge role={role} />
          </View>

          {/* Status Badges */}
          <View className="flex-row items-center gap-1">
            <View
              className={`${c.videoStatusBadge} ${isMicOn ? "bg-green-500/20" : "bg-red-500/20"}`}
            >
              {isMicOn ? (
                <Mic size={12} color={colors.online} />
              ) : (
                <MicOff size={12} color={colors.muted} />
              )}
            </View>
            {!isCameraOn && (
              <View className={`${c.videoStatusBadge} bg-red-500/20`}>
                <VideoOff size={12} color={colors.muted} />
              </View>
            )}
          </View>
        </View>
      </View>

      {/* Speaking Indicator */}
      {isMicOn && (
        <View className="absolute top-2 right-2">
          <View className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
        </View>
      )}
    </Pressable>
  );
}

function RoleBadge({ role }: { role: MemberRole }) {
  if (role === "participant") return null;

  const isHost = role === "host";
  const Icon = isHost ? Crown : Shield;
  const color = isHost ? colors.host : colors.moderator;
  const bgClass = isHost ? "bg-amber-500/20" : "bg-blue-500/20";

  return (
    <View className={`${c.badge} ${bgClass} flex-row items-center gap-1`}>
      <Icon size={10} color={color} />
      <Text style={{ color, fontSize: 10, fontWeight: "600" }}>
        {isHost ? "Host" : "Mod"}
      </Text>
    </View>
  );
}

export function VideoTileSkeleton({ isLarge = false }: { isLarge?: boolean }) {
  return (
    <View
      className={`${isLarge ? c.videoTileLarge : c.videoTileSmall} ${c.skeleton}`}
    >
      <View className="flex-1 items-center justify-center">
        <View
          className={`${c.skeletonCircle} ${isLarge ? "w-20 h-20" : "w-14 h-14"}`}
        />
      </View>
      <View className={c.videoOverlay}>
        <View className={`${c.skeleton} w-20 h-5 rounded-full`} />
      </View>
    </View>
  );
}
