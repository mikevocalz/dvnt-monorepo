/** Host queue: oldest first, privacy-safe aliases, and local-only dismissal. */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Pressable, StyleSheet, Text, View } from "react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetFlatList,
} from "@gorhom/bottom-sheet";
import type { BottomSheetBackdropProps } from "@gorhom/bottom-sheet";
import { Crown, Hand, X } from "lucide-react-native";
import { Avatar } from "@dvnt/app/components/ui/avatar";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import type { VideoParticipant } from "./VideoGrid";
import { buildHandQueue, HAND_QUEUE_COPY, type HandQueueEntry } from "./hand-queue";
import { participantModeration } from "./moderation-permissions";

interface HandQueueSheetProps {
  visible: boolean;
  /** All room participants — we filter by raisedHandOrder below. */
  participants: VideoParticipant[];
  /** FIFO ordered userIds whose hands are raised. */
  raisedHandOrder: string[];
  onDismiss: () => void;
  /** Grants co-host moderation, not only permission to speak. */
  onInviteToSpeak: (userId: string) => void | boolean | Promise<void | boolean>;
  /** Dismisses this entry locally, without changing the guest's hand. */
  onLowerHand: (userId: string) => void;
  /** Clears only this host's local queue view. */
  onLowerAll: () => void;
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
  const inFlight = useRef(new Set<string>());
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const invite = useCallback(async (userId: string) => {
    if (inFlight.current.has(userId)) return;
    inFlight.current.add(userId);
    setPending(new Set(inFlight.current));
    setActionError(null);
    try {
      // A cancellation or server denial retains the FIFO entry for retry.
      // The room callback owns success state and server-error feedback.
      await onInviteToSpeak(userId);
    } catch {
      setActionError("Couldn't update this Lynk. Check your connection and try again.");
    } finally {
      inFlight.current.delete(userId);
      setPending(new Set(inFlight.current));
    }
  }, [onInviteToSpeak]);

  const actor = participants.find((participant) => participant.isLocal);
  const queue = useMemo(() => buildHandQueue(
    raisedHandOrder,
    participants.map((participant) => ({ ...participant.user, userId: participant.id })),
  ), [participants, raisedHandOrder]);
  const waiting = queue.filter((entry) => !entry.departed).length;

  useEffect(() => {
    if (visible) {
      sheetRef.current?.snapToIndex(0);
    } else {
      sheetRef.current?.close();
    }
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const back = BackHandler.addEventListener("hardwareBackPress", () => { onDismiss(); return true; });
    return () => back.remove();
  }, [visible, onDismiss]);

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
    ({ item }: { item: HandQueueEntry }) => {
      const { userId: id, position: queueIndex, label, isAnonymous: isAnon } = item;
      const participant = participants.find((participant) => participant.id === id);
      const busy = pending.has(id);
      const canPromote = !!participant && participant.role !== "co-host" &&
        participantModeration(actor?.role, actor?.id, id, participant.role).changeRole;

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
              {canPromote ? <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Make ${label} a co-host`}
                disabled={busy}
                accessibilityState={{ disabled: busy, busy }}
                onPress={() => void invite(id)}
                style={({ pressed }) => [
                  styles.primaryAction,
                  {
                    backgroundColor: colors.primary,
                    opacity: busy ? 0.4 : pressed ? 0.85 : 1,
                  },
                ]}
              >
                <Crown size={14} color={colors.primaryForeground} />
                <Text
                  style={[
                    styles.primaryActionLabel,
                    { color: colors.primaryForeground },
                  ]}
                >
                  {busy ? "Please wait…" : HAND_QUEUE_COPY.invite}
                </Text>
              </Pressable> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Dismiss ${label} from your queue`}
                disabled={busy}
                accessibilityState={{ disabled: busy }}
                onPress={() => onLowerHand(id)}
                style={({ pressed }) => [
                  styles.secondaryAction,
                  {
                    borderColor: `${colors.destructive}40`,
                    backgroundColor: `${colors.destructive}10`,
                    opacity: busy ? 0.4 : pressed ? 0.8 : 1,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.secondaryActionLabel,
                    { color: colors.destructive },
                  ]}
                >
                  {HAND_QUEUE_COPY.lower}
                </Text>
              </Pressable>
            </View>
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Clear position ${queueIndex} from your queue`}
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
    [colors, invite, onLowerHand, participants, actor?.role, actor?.id, pending],
  );

  const keyExtractor = useCallback((item: HandQueueEntry) => item.userId, []);

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
              {waiting}{" "}
              <Text style={[styles.titleSuffix, { color: colors.foreground }]}>
                {waiting === 1 ? "hand raised" : "hands raised"}
              </Text>
            </Text>
          </View>
          <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>
            Oldest first. Co-hosts gain moderation controls. {HAND_QUEUE_COPY.dismissalHint}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close raised hands"
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

      {actionError ? <Text accessibilityRole="alert" style={{ color: colors.destructive, paddingHorizontal: 20, paddingBottom: 12 }}>{actionError}</Text> : null}
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
              {HAND_QUEUE_COPY.empty}
            </Text>
          </View>
        }
        ListFooterComponent={
          queue.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Clear raised hands from your view"
              disabled={pending.size > 0}
              accessibilityState={{ disabled: pending.size > 0 }}
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
                {HAND_QUEUE_COPY.lowerAll}
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
    width: 44,
    height: 44,
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
    minHeight: 44,
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
    minHeight: 44,
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
    minHeight: 44,
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
    minHeight: 44,
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
