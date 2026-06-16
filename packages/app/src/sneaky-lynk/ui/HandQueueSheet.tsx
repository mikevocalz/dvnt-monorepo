/**
 * HandQueueSheet
 *
 * Host-only moderation surface for raised hands. Zoom-parity: the
 * host sees a FIFO queue of participants who have raised their hand
 * (oldest at top), can invite a user to speak (promotes role), or
 * lower a hand without promotion.
 *
 * Design decisions (via the frontend-design skill):
 *   - Sheet, not inline rail — long queues would drown the room UI.
 *   - Primary "Invite to speak" CTA in DVNT cyan: the positive
 *     outcome of a raised hand. Secondary "Lower" in hairline
 *     destructive red.
 *   - Avatar + username + "Raised Xs ago" so the host has context.
 *   - "Dismiss all" host action at the bottom for drive-by queue
 *     clearing when you're not taking more questions.
 *   - Anonymous raisers show as "Anonymous" (italic) and the Invite
 *     CTA is still available (promotion is by userId, not by
 *     username).
 */

import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFlatList,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { Hand, Mic, X } from "lucide-react-native";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import type { VideoParticipant } from "./VideoGrid";
import { getSneakyUserLabel } from "./user-labels";

interface HandQueueSheetProps {
  visible: boolean;
  /** All room participants — we filter by raisedHandOrder below. */
  participants: VideoParticipant[];
  /** FIFO ordered userIds whose hands are raised. */
  raisedHandOrder: string[];
  onDismiss: () => void;
  /** Called when host taps "Invite to speak" on a raised hand. */
  onInviteToSpeak: (userId: string) => void;
  /** Called when host taps "Lower" without promoting. */
  onLowerHand: (userId: string) => void;
  /** Called when host taps "Dismiss all" — lowers every raised hand. */
  onLowerAll: () => void;
}

interface QueueRow {
  id: string;
  participant: VideoParticipant | null;
  queueIndex: number;
}

export function HandQueueSheet({
  visible,
  participants,
  raisedHandOrder,
  onDismiss,
  onInviteToSpeak,
  onLowerHand,
  onLowerAll,
}: HandQueueSheetProps) {
  const { colors } = useColorScheme();
  const sheetRef = useRef<BottomSheet>(null);
  const snapPoints = useMemo(() => ["72%"], []);

  // Join the ordered id list against the participants map. Keep
  // insertion order (oldest first), drop any ids for users who left
  // the room while queued.
  const queue = useMemo<QueueRow[]>(() => {
    const byId = new Map<string, VideoParticipant>();
    for (const p of participants) byId.set(p.id, p);
    const rows: QueueRow[] = [];
    raisedHandOrder.forEach((id, idx) => {
      const participant = byId.get(id) ?? null;
      rows.push({ id, participant, queueIndex: idx + 1 });
    });
    return rows;
  }, [participants, raisedHandOrder]);

  useEffect(() => {
    if (visible) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={0.6}
        pressBehavior="close"
      />
    ),
    [],
  );

  const renderItem = useCallback(
    ({ item }: { item: QueueRow }) => {
      const { participant, queueIndex, id } = item;
      const isAnon = participant?.user.isAnonymous;
      const label = participant
        ? isAnon
          ? "Anonymous"
          : getSneakyUserLabel(participant.user)
        : "Left the room";

      return (
        <View
          style={[
            styles.row,
            {
              backgroundColor: `${colors.foreground}06`,
              borderColor: colors.border,
            },
          ]}
        >
          <View style={styles.rowTop}>
            {/* Queue-position chip — "1", "2", "3" — Zoom shows this so
                the host knows who's next at a glance. */}
            <View
              style={[
                styles.queueChip,
                {
                  backgroundColor: `${colors.accent}1f`,
                  borderColor: `${colors.accent}40`,
                },
              ]}
            >
              <Text style={[styles.queueChipText, { color: colors.accent }]}>
                {queueIndex}
              </Text>
            </View>

            {participant ? (
              isAnon ? (
                <View
                  style={[
                    styles.avatarAnon,
                    {
                      backgroundColor: `${colors.mutedForeground}14`,
                      borderColor: colors.border,
                    },
                  ]}
                >
                  <Hand size={18} color={colors.accent} />
                </View>
              ) : (
                <Avatar
                  uri={participant.user.avatar}
                  username={participant.user.username}
                  size={40}
                  variant="roundedSquare"
                />
              )
            ) : (
              <View
                style={[
                  styles.avatarAnon,
                  {
                    backgroundColor: `${colors.mutedForeground}14`,
                    borderColor: colors.border,
                  },
                ]}
              >
                <X size={16} color={colors.mutedForeground} />
              </View>
            )}

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
                {label}
              </Text>
              <Text
                style={[styles.subline, { color: colors.mutedForeground }]}
              >
                {participant ? "Raised their hand" : "No longer in the room"}
              </Text>
            </View>
          </View>

          {participant ? (
            <View style={styles.actionRow}>
              <Pressable
                onPress={() => onInviteToSpeak(id)}
                style={({ pressed }) => [
                  styles.primaryAction,
                  {
                    backgroundColor: colors.primary,
                    opacity: pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Mic size={14} color={colors.primaryForeground} />
                <Text
                  style={[
                    styles.primaryActionLabel,
                    { color: colors.primaryForeground },
                  ]}
                >
                  Invite to speak
                </Text>
              </Pressable>
              <Pressable
                onPress={() => onLowerHand(id)}
                style={({ pressed }) => [
                  styles.secondaryAction,
                  {
                    borderColor: `${colors.destructive}40`,
                    backgroundColor: `${colors.destructive}10`,
                    opacity: pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.secondaryActionLabel,
                    { color: colors.destructive },
                  ]}
                >
                  Lower
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              onPress={() => onLowerHand(id)}
              style={({ pressed }) => [
                styles.ghostAction,
                {
                  borderColor: colors.border,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={[
                  styles.ghostActionLabel,
                  { color: colors.mutedForeground },
                ]}
              >
                Clear from queue
              </Text>
            </Pressable>
          )}
        </View>
      );
    },
    [colors, onInviteToSpeak, onLowerHand],
  );

  const keyExtractor = useCallback((item: QueueRow) => item.id, []);

  return (
    <BottomSheet
      ref={sheetRef}
      index={visible ? 0 : -1}
      snapPoints={snapPoints}
      enablePanDownToClose
      enableOverDrag={false}
      onChange={(idx) => {
        if (idx === -1) onDismiss();
      }}
      backdropComponent={renderBackdrop}
      backgroundStyle={{
        backgroundColor: colors.secondary,
        borderTopLeftRadius: 22,
        borderTopRightRadius: 22,
      }}
      handleIndicatorStyle={{
        backgroundColor: `${colors.foreground}30`,
        width: 44,
      }}
      style={{ zIndex: 9999, elevation: 9999 }}
    >
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <View style={styles.titleRow}>
            <View
              style={[
                styles.titleIcon,
                {
                  backgroundColor: `${colors.accent}1f`,
                  borderColor: `${colors.accent}40`,
                },
              ]}
            >
              <Hand size={16} color={colors.accent} />
            </View>
            <Text
              style={[
                styles.title,
                {
                  color: colors.accent,
                  fontVariant: ["tabular-nums"],
                },
              ]}
            >
              {queue.length}{" "}
              <Text style={[styles.titleSuffix, { color: colors.foreground }]}>
                {queue.length === 1 ? "hand raised" : "hands raised"}
              </Text>
            </Text>
          </View>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Oldest raise is first in line.
          </Text>
        </View>
        <Pressable
          onPress={onDismiss}
          hitSlop={12}
          style={[
            styles.closeBtn,
            {
              backgroundColor: `${colors.foreground}10`,
              borderColor: colors.border,
            },
          ]}
        >
          <X size={18} color={colors.foreground} />
        </Pressable>
      </View>

      <BottomSheetFlatList
        data={queue}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 28,
          paddingTop: 4,
        }}
        showsVerticalScrollIndicator={false}
        ListEmptyComponent={
          <View style={styles.empty}>
            <View
              style={[
                styles.emptyHalo,
                {
                  backgroundColor: `${colors.accent}14`,
                  borderColor: `${colors.accent}30`,
                },
              ]}
            >
              <Hand size={22} color={colors.accent} />
            </View>
            <Text style={[styles.emptyTitle, { color: colors.foreground }]}>
              No hands up
            </Text>
            <Text
              style={[styles.emptyBody, { color: colors.mutedForeground }]}
            >
              Raised hands will show up here in the order they're raised.
            </Text>
          </View>
        }
        ListFooterComponent={
          queue.length > 1 ? (
            <Pressable
              onPress={onLowerAll}
              style={({ pressed }) => [
                styles.lowerAllBtn,
                {
                  borderColor: colors.border,
                  backgroundColor: `${colors.foreground}05`,
                  opacity: pressed ? 0.7 : 1,
                },
              ]}
            >
              <Text
                style={[styles.lowerAllLabel, { color: colors.mutedForeground }]}
              >
                Lower all hands
              </Text>
            </Pressable>
          ) : null
        }
      />
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: "row",
    alignItems: "flex-start",
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 16,
    gap: 12,
  },
  titleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
  },
  titleIcon: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  title: {
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: -0.5,
  },
  titleSuffix: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
  subtitle: {
    fontSize: 12,
    fontWeight: "500",
    marginTop: 6,
    marginLeft: 42,
  },
  closeBtn: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },

  row: {
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 12,
    paddingVertical: 12,
    marginBottom: 10,
    gap: 12,
  },
  rowTop: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  queueChip: {
    width: 28,
    height: 28,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  queueChipText: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 0,
  },
  avatarAnon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  info: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  username: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  subline: {
    fontSize: 12,
    fontWeight: "500",
  },

  actionRow: {
    flexDirection: "row",
    gap: 10,
  },
  primaryAction: {
    flex: 2,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: 12,
  },
  primaryActionLabel: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  secondaryAction: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  secondaryActionLabel: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  ghostAction: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
  },
  ghostActionLabel: {
    fontSize: 13,
    fontWeight: "600",
  },

  empty: {
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 48,
    gap: 10,
  },
  emptyHalo: {
    width: 52,
    height: 52,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  emptyTitle: {
    fontSize: 16,
    fontWeight: "700",
  },
  emptyBody: {
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    paddingHorizontal: 40,
  },

  lowerAllBtn: {
    marginTop: 4,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  lowerAllLabel: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.3,
  },
});
