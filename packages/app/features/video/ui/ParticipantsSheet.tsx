/**
 * ParticipantsSheet Component
 * Bottom sheet showing room participants with moderation actions
 */

import React, { useCallback, useMemo } from "react";
import { View, Text, Pressable } from "react-native";
import { Image } from "expo-image";
import BottomSheet, {
  BottomSheetView,
  BottomSheetScrollView,
} from "@gorhom/bottom-sheet";
import {
  Crown,
  Shield,
  Mic,
  MicOff,
  Video,
  VideoOff,
  MoreVertical,
  UserMinus,
  Ban,
  X,
} from "lucide-react-native";
import { c, colors } from "./styles";
import type { Participant, MemberRole } from "../types";

interface ParticipantsSheetProps {
  participants: Participant[];
  localUserId: string;
  localUserRole: MemberRole;
  onKick?: (userId: string) => void;
  onBan?: (userId: string) => void;
  onClose: () => void;
  bottomSheetRef: React.RefObject<BottomSheet>;
}

export function ParticipantsSheet({
  participants,
  localUserId,
  localUserRole,
  onKick,
  onBan,
  onClose,
  bottomSheetRef,
}: ParticipantsSheetProps) {
  const snapPoints = useMemo(() => ["50%", "80%"], []);
  const canModerate = localUserRole === "host" || localUserRole === "moderator";

  const sortedParticipants = useMemo(() => {
    return [...participants].sort((a, b) => {
      const roleOrder: Record<string, number> = {
        host: 0,
        "co-host": 1,
        moderator: 1,
        participant: 2,
      };
      const aOrder = roleOrder[a.role] ?? 2;
      const bOrder = roleOrder[b.role] ?? 2;
      if (aOrder !== bOrder) return aOrder - bOrder;
      if (a.userId === localUserId) return -1;
      if (b.userId === localUserId) return 1;
      return 0;
    });
  }, [participants, localUserId]);

  const handleKick = useCallback(
    (userId: string) => {
      onKick?.(userId);
    },
    [onKick],
  );

  const handleBan = useCallback(
    (userId: string) => {
      onBan?.(userId);
    },
    [onBan],
  );

  return (
    <BottomSheet
      ref={bottomSheetRef}
      index={-1}
      snapPoints={snapPoints}
      enablePanDownToClose
      backgroundStyle={{ backgroundColor: "rgb(var(--card))" }}
      handleIndicatorStyle={{
        backgroundColor: "rgb(var(--muted-foreground))",
        opacity: 0.3,
      }}
      style={{ zIndex: 9999, elevation: 9999 }}
    >
      <BottomSheetView className="flex-1 px-4">
        {/* Header */}
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            marginBottom: 16,
          }}
        >
          <Text style={{ fontSize: 18, fontWeight: "700", color: "#34A2DF" }}>
            Participants ({participants.length})
          </Text>
          <Pressable
            onPress={onClose}
            style={{
              width: 32,
              height: 32,
              borderRadius: 16,
              backgroundColor: "rgba(255,255,255,0.1)",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <X size={22} color="#fff" />
          </Pressable>
        </View>

        {/* Participants List */}
        <BottomSheetScrollView
          style={{ flex: 1 }}
          showsVerticalScrollIndicator={false}
        >
          {sortedParticipants.map((participant) => (
            <ParticipantRow
              key={participant.userId}
              participant={participant}
              isLocal={participant.userId === localUserId}
              canModerate={canModerate && participant.userId !== localUserId}
              canKick={
                canModerate &&
                participant.userId !== localUserId &&
                participant.role !== "host" &&
                (localUserRole === "host" || participant.role === "participant")
              }
              canBan={
                localUserRole === "host" &&
                participant.userId !== localUserId &&
                participant.role !== "host"
              }
              onKick={() => handleKick(participant.userId)}
              onBan={() => handleBan(participant.userId)}
            />
          ))}
        </BottomSheetScrollView>
      </BottomSheetView>
    </BottomSheet>
  );
}

interface ParticipantRowProps {
  participant: Participant;
  isLocal: boolean;
  canModerate: boolean;
  canKick: boolean;
  canBan: boolean;
  onKick: () => void;
  onBan: () => void;
}

function ParticipantRow({
  participant,
  isLocal,
  canModerate,
  canKick,
  canBan,
  onKick,
  onBan,
}: ParticipantRowProps) {
  const {
    username,
    displayName,
    avatar,
    role,
    isCameraOn,
    isMicOn,
    isAnonymous,
    anonLabel,
  } = participant;
  const resolvedName = anonLabel || username || displayName || "Guest";
  const initials = resolvedName.slice(0, 2).toUpperCase();

  const [showActions, setShowActions] = React.useState(false);

  return (
    <View className={c.listItemBorder}>
      {/* Avatar */}
      {avatar && !isAnonymous ? (
        <Image
          source={{ uri: avatar }}
          className={c.avatarMd}
          contentFit="cover"
        />
      ) : (
        <View
          className={`${c.avatarMd} items-center justify-center bg-primary/20`}
        >
          <Text className="text-sm font-bold text-primary">{initials}</Text>
        </View>
      )}

      {/* Info */}
      <View className="flex-1">
        <View className="flex-row items-center gap-2">
          <Text className={c.textSubtitle} numberOfLines={1}>
            {resolvedName}
            {isLocal && " (You)"}
          </Text>
          <RoleBadge role={role} />
        </View>
        <View className="flex-row items-center gap-2 mt-1">
          {isMicOn ? (
            <Mic size={12} color={colors.online} />
          ) : (
            <MicOff size={12} color={colors.muted} />
          )}
          {isCameraOn ? (
            <Video size={12} color={colors.online} />
          ) : (
            <VideoOff size={12} color={colors.muted} />
          )}
        </View>
      </View>

      {/* Actions */}
      {canModerate && (
        <View className="relative">
          <Pressable
            className="p-2"
            onPress={() => setShowActions(!showActions)}
          >
            <MoreVertical size={18} color="rgb(var(--muted-foreground))" />
          </Pressable>

          {showActions && (
            <View className="absolute right-0 top-10 bg-card border border-border rounded-xl shadow-lg z-10 overflow-hidden">
              {canKick && (
                <Pressable
                  className="flex-row items-center gap-2 px-4 py-3 active:bg-muted"
                  onPress={() => {
                    setShowActions(false);
                    onKick();
                  }}
                >
                  <UserMinus size={16} color={colors.muted} />
                  <Text className="text-destructive">Kick</Text>
                </Pressable>
              )}
              {canBan && (
                <Pressable
                  className="flex-row items-center gap-2 px-4 py-3 active:bg-muted"
                  onPress={() => {
                    setShowActions(false);
                    onBan();
                  }}
                >
                  <Ban size={16} color={colors.muted} />
                  <Text className="text-destructive">Ban</Text>
                </Pressable>
              )}
            </View>
          )}
        </View>
      )}
    </View>
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
