/**
 * RoomParticipantsSheet
 *
 * Live roster of a Sneaky Lynk room. Custom overlay (not gorhom/bottom-sheet)
 * so it renders above the video room's native stacking context on all devices.
 * Same pattern as StoryViewersSheet: absolute-fill overlay + Pressable backdrop
 * + LegendList inside a bottom-anchored card.
 *
 * Design (DVNT editorial dark):
 *   - Hero counter: large tabular number + "in the room" suffix
 *   - Rounded-square avatars (house style — never circular)
 *   - Role chips (host=cyan fill, co-host/mod=hairline outline)
 *   - Hand-raised accent pink pill when raised
 *   - Mic muted: small red icon badge on the right
 *   - Host moderation: compact icon-only buttons on the right when host
 *   - Stagger-fade entering animation on first 8 rows (50ms stride)
 */

import React, { useCallback, useMemo } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import Animated, {
  FadeInDown,
} from "react-native-reanimated";
import { useRouter } from "expo-router";
import {
  Crown,
  EyeOff,
  Mic,
  MicOff,
  Shield,
  Users,
  UserMinus,
  X,
} from "lucide-react-native";
import { Avatar } from "@/components/ui/avatar";
import { LegendList } from "@/components/list";
import { useColorScheme } from "@/lib/hooks";
import type { VideoParticipant } from "./VideoGrid";
import { getSneakyUserLabel } from "./user-labels";

interface RoomParticipantsSheetProps {
  visible: boolean;
  participants: VideoParticipant[];
  localUserId: string;
  isHost: boolean;
  onDismiss: () => void;
  onMute: (userId: string) => void;
  onUnmute: (userId: string) => void;
  onRemove: (userId: string) => void;
}

const ROLE_ORDER: Record<string, number> = {
  host: 0,
  "co-host": 1,
  moderator: 2,
  participant: 3,
  speaker: 4,
  listener: 5,
};

interface RoleMeta {
  label: string;
  icon: (color: string) => React.ReactNode;
  useAccent: boolean;
}

function getRoleMeta(role: string): RoleMeta | null {
  switch (role) {
    case "host":
      return {
        label: "Host",
        icon: (c) => <Crown size={11} color={c} />,
        useAccent: true,
      };
    case "co-host":
      return {
        label: "Co-host",
        icon: (c) => <Shield size={11} color={c} />,
        useAccent: false,
      };
    case "moderator":
      return {
        label: "Mod",
        icon: (c) => <Shield size={11} color={c} />,
        useAccent: false,
      };
    default:
      return null;
  }
}

// ── Participant row ───────────────────────────────────────────────────────────

function ParticipantRow({
  item,
  index,
  localUserId,
  isHost,
  colors,
  onProfilePress,
  onMute,
  onUnmute,
  onRemove,
}: {
  item: VideoParticipant;
  index: number;
  localUserId: string;
  isHost: boolean;
  colors: ReturnType<typeof useColorScheme>["colors"];
  onProfilePress: (username: string) => void;
  onMute: (userId: string) => void;
  onUnmute: (userId: string) => void;
  onRemove: (userId: string) => void;
}) {
  const isSelf = item.id === localUserId;
  const isAnon = item.user.isAnonymous;
  const displayLabel = isAnon ? "Anonymous" : getSneakyUserLabel(item.user);
  const roleMeta = getRoleMeta(item.role);
  const canModerate = isHost && !isSelf && item.role !== "host";
  const delay = index < 8 ? index * 50 : 0;

  const avatarEl = isAnon ? (
    <View
      style={[
        styles.avatarAnon,
        {
          backgroundColor: `${colors.mutedForeground}14`,
          borderColor: colors.border,
        },
      ]}
    >
      <EyeOff size={20} color={colors.mutedForeground} />
    </View>
  ) : (
    <Avatar
      uri={item.user.avatar}
      username={item.user.username}
      size={44}
      variant="roundedSquare"
    />
  );

  return (
    <Animated.View
      entering={FadeInDown.delay(delay).duration(200).springify().damping(22)}
    >
      <View style={styles.row}>
        {/* Avatar — tappable if not anon */}
        {isAnon ? (
          <View style={styles.avatarSlot}>{avatarEl}</View>
        ) : (
          <Pressable
            onPress={() => onProfilePress(item.user.username)}
            hitSlop={6}
            style={({ pressed }) => [
              styles.avatarSlot,
              { opacity: pressed ? 0.7 : 1 },
            ]}
          >
            {avatarEl}
          </Pressable>
        )}

        {/* Name + chips */}
        <View style={styles.info}>
          <Text
            style={[
              styles.username,
              {
                color: colors.foreground,
                fontStyle: isAnon ? "italic" : "normal",
              },
            ]}
            numberOfLines={1}
          >
            {displayLabel}
            {isSelf ? (
              <Text style={{ color: colors.mutedForeground }}>{" (You)"}</Text>
            ) : null}
          </Text>

          {(roleMeta || item.isHandRaised) ? (
            <View style={styles.chipsRow}>
              {roleMeta ? (
                <View
                  style={[
                    styles.chip,
                    roleMeta.useAccent
                      ? {
                          backgroundColor: colors.primary,
                          borderColor: colors.primary,
                        }
                      : {
                          backgroundColor: `${colors.primary}1f`,
                          borderColor: `${colors.primary}40`,
                        },
                  ]}
                >
                  {roleMeta.icon(
                    roleMeta.useAccent ? colors.primaryForeground : colors.primary,
                  )}
                  <Text
                    style={[
                      styles.chipLabel,
                      {
                        color: roleMeta.useAccent
                          ? colors.primaryForeground
                          : colors.primary,
                      },
                    ]}
                  >
                    {roleMeta.label}
                  </Text>
                </View>
              ) : null}

              {item.isHandRaised ? (
                <View
                  style={[
                    styles.chip,
                    {
                      backgroundColor: `${colors.accent}1f`,
                      borderColor: `${colors.accent}40`,
                    },
                  ]}
                >
                  <Text style={[styles.chipLabel, { color: colors.accent }]}>
                    ✋ Hand up
                  </Text>
                </View>
              ) : null}
            </View>
          ) : null}
        </View>

        {/* Right-side actions: mic status + optional mod buttons */}
        <View style={styles.rightActions}>
          {/* Muted badge — only shown when muted */}
          {!item.isMicOn ? (
            <View
              style={[
                styles.micBadge,
                {
                  backgroundColor: `${colors.destructive}1a`,
                  borderColor: `${colors.destructive}40`,
                },
              ]}
            >
              <MicOff size={13} color={colors.destructive} />
            </View>
          ) : null}

          {/* Host-only compact mod buttons */}
          {canModerate ? (
            <>
              <Pressable
                onPress={() =>
                  item.isMicOn ? onMute(item.id) : onUnmute(item.id)
                }
                hitSlop={8}
                style={({ pressed }) => [
                  styles.modIcon,
                  {
                    backgroundColor: item.isMicOn
                      ? `${colors.destructive}14`
                      : `${colors.primary}14`,
                    borderColor: item.isMicOn
                      ? `${colors.destructive}40`
                      : `${colors.primary}40`,
                    opacity: pressed ? 0.65 : 1,
                  },
                ]}
              >
                {item.isMicOn ? (
                  <MicOff size={14} color={colors.destructive} />
                ) : (
                  <Mic size={14} color={colors.primary} />
                )}
              </Pressable>

              <Pressable
                onPress={() => onRemove(item.id)}
                hitSlop={8}
                style={({ pressed }) => [
                  styles.modIcon,
                  {
                    backgroundColor: `${colors.destructive}14`,
                    borderColor: `${colors.destructive}40`,
                    opacity: pressed ? 0.65 : 1,
                  },
                ]}
              >
                <UserMinus size={14} color={colors.destructive} />
              </Pressable>
            </>
          ) : null}
        </View>
      </View>
    </Animated.View>
  );
}

// ── Main sheet ────────────────────────────────────────────────────────────────

export function RoomParticipantsSheet({
  visible,
  participants,
  localUserId,
  isHost,
  onDismiss,
  onMute,
  onUnmute,
  onRemove,
}: RoomParticipantsSheetProps) {
  const { colors } = useColorScheme();
  const router = useRouter();

  const sortedParticipants = useMemo(
    () =>
      [...participants].sort((a, b) => {
        const aOrder = ROLE_ORDER[a.role] ?? 99;
        const bOrder = ROLE_ORDER[b.role] ?? 99;
        if (aOrder !== bOrder) return aOrder - bOrder;
        if (!!a.isHandRaised !== !!b.isHandRaised) return a.isHandRaised ? -1 : 1;
        if (a.id === localUserId) return -1;
        if (b.id === localUserId) return 1;
        return getSneakyUserLabel(a.user).localeCompare(getSneakyUserLabel(b.user));
      }),
    [participants, localUserId],
  );

  const handleProfilePress = useCallback(
    (username: string) => {
      if (!username) return;
      router.push(`/(protected)/profile/${username}` as any);
      onDismiss();
    },
    [onDismiss, router],
  );

  const keyExtractor = useCallback((item: VideoParticipant) => item.id, []);

  const renderItem = useCallback(
    ({ item, index }: { item: VideoParticipant; index: number }) => (
      <ParticipantRow
        item={item}
        index={index}
        localUserId={localUserId}
        isHost={isHost}
        colors={colors}
        onProfilePress={handleProfilePress}
        onMute={onMute}
        onUnmute={onUnmute}
        onRemove={onRemove}
      />
    ),
    [colors, handleProfilePress, isHost, localUserId, onMute, onRemove, onUnmute],
  );

  if (!visible) return null;

  return (
    <View style={styles.overlay} pointerEvents="auto">
      <Pressable style={styles.backdrop} onPress={onDismiss} />
      <View
        style={[
          styles.sheet,
          { backgroundColor: colors.secondary, borderColor: colors.border },
        ]}
      >
        {/* Hero header */}
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text
              style={[
                styles.heroCount,
                { color: colors.primary, fontVariant: ["tabular-nums"] },
              ]}
            >
              {participants.length}
            </Text>
            <View style={styles.heroLabelRow}>
              <Text
                style={[styles.heroLabel, { color: colors.mutedForeground }]}
              >
                {participants.length === 1 ? "person" : "people"} in the room
              </Text>
              {isHost ? (
                <Text
                  style={[styles.hostHint, { color: colors.mutedForeground }]}
                >
                  · tap icons to mute or remove
                </Text>
              ) : null}
            </View>
          </View>
          <Pressable
            onPress={onDismiss}
            hitSlop={12}
            style={[
              styles.closeBtn,
              {
                backgroundColor: "rgba(0,0,0,0.45)",
                borderColor: colors.border,
              },
            ]}
          >
            <X size={18} color="rgb(255, 109, 193)" />
          </Pressable>
        </View>

        {/* Participant list */}
        {participants.length === 0 ? (
          <View style={styles.emptyWrap}>
            <View
              style={[styles.emptyRing, { borderColor: `${colors.primary}66` }]}
            >
              <View
                style={[
                  styles.emptyRingInner,
                  { borderColor: `${colors.accent}55` },
                ]}
              />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No one here yet
            </Text>
            <Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>
              Participants will show up as they join.
            </Text>
          </View>
        ) : (
          <LegendList
            data={sortedParticipants}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            estimatedItemSize={64}
            recycleItems
            contentContainerStyle={{
              paddingHorizontal: 16,
              paddingBottom: 32,
              paddingTop: 4,
            }}
            showsVerticalScrollIndicator={false}
          />
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 9999,
    elevation: 9999,
    justifyContent: "flex-end",
  },
  backdrop: {
    ...StyleSheet.absoluteFill,
    backgroundColor: "rgba(0,0,0,0.62)",
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    maxHeight: "78%",
    minHeight: 340,
  },

  // Header
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 18,
    paddingBottom: 14,
  },
  heroCount: {
    fontSize: 52,
    fontWeight: "800",
    letterSpacing: -2,
    lineHeight: 56,
  },
  heroLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 4,
    marginTop: 2,
  },
  heroLabel: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  hostHint: {
    fontSize: 11,
    fontWeight: "500",
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 4,
  },

  // Row
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 4,
  },
  avatarSlot: {
    width: 44,
    flexShrink: 0,
  },
  avatarAnon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    justifyContent: "center",
  },
  username: {
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  chipsRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexWrap: "wrap",
  },
  chip: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: 100,
    borderWidth: StyleSheet.hairlineWidth,
  },
  chipLabel: {
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.4,
    textTransform: "uppercase",
  },

  // Right-side actions
  rightActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flexShrink: 0,
  },
  micBadge: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  modIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },

  // Empty state
  emptyWrap: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 32,
    paddingBottom: 56,
    gap: 8,
  },
  emptyRing: {
    width: 72,
    height: 72,
    borderRadius: 20,
    borderWidth: 2,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 10,
  },
  emptyRingInner: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 2,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  emptyBody: {
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    paddingHorizontal: 32,
  },
});
