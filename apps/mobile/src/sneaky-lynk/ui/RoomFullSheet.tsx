/**
 * RoomFullSheet
 *
 * Premium capacity-flow surface for Sneaky Lynk rooms. Replaces the
 * generic "Error: Room is full" toast with a dedicated, branched UX:
 *
 *   Host branch  — you (the host) hit your plan's seat limit. Primary
 *                  CTA is "Upgrade" with accent pink for empowering
 *                  upsell tone. Crown icon.
 *   Viewer branch — room is popping, you can't get in yet. Primary CTA
 *                   is "Notify me" which starts a 2s live-capacity poll
 *                   and auto-retries when a seat opens. Cyan icon +
 *                   soft pulse on the seat count while waiting.
 *
 * Design notes (per the frontend-design skill's direction):
 *   - Velvet-rope nightlife tone. Confident, not apologetic.
 *   - One hero number ("12/12"). Sub-label in muted grey.
 *   - One primary CTA in DVNT cyan (viewer) or accent pink (host).
 *   - Hairline "Close" secondary.
 *   - Single choreographed entrance: scale 0.96 → 1 + fade, 240ms.
 *   - Waiting state: cyan seat number with soft opacity pulse every
 *     1.6s. Zero fidget anywhere else.
 *   - Pulls every color from `useColorScheme` so a DVNT rebrand
 *     re-tints the sheet automatically.
 */

import { useCallback, useEffect } from "react";
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
  ActivityIndicator,
} from "react-native";
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withRepeat,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import { Crown, Users, Check } from "lucide-react-native";
import { useColorScheme } from "@/lib/hooks";
import type { CapacityDetail } from "../errors";
import { useRoomCapacityWatcher } from "../hooks/useRoomCapacityWatcher";

type Phase = "idle" | "waiting" | "seat-open";

interface RoomFullSheetProps {
  visible: boolean;
  capacity: CapacityDetail | null;
  roomId: string | undefined;
  onClose: () => void;
  /** Fired when the user taps "Notify me" — starts the watcher. */
  onStartWaiting: () => void;
  /** Non-null while we're watching for a seat. */
  phase: Phase;
  /** Fired when a seat opens — caller retries the join. */
  onSeatOpen: () => void;
  /** Fired when the host taps "Upgrade". */
  onUpgrade: () => void;
  /** Fired when a viewer taps "Pay $2.99 to join". Only shown when provided. */
  onPayToJoin?: () => void;
}

export function RoomFullSheet({
  visible,
  capacity,
  roomId,
  onClose,
  onStartWaiting,
  phase,
  onSeatOpen,
  onUpgrade,
  onPayToJoin,
}: RoomFullSheetProps) {
  const { colors } = useColorScheme();

  const isHost = !!capacity?.isHost;
  const current = capacity?.current ?? 0;
  const max = capacity?.max ?? 0;

  // Entrance choreography — scale + fade. One event, no fidget.
  const entrance = useSharedValue(0);
  useEffect(() => {
    if (visible) {
      entrance.value = withTiming(1, {
        duration: 240,
        easing: Easing.out(Easing.cubic),
      });
    } else {
      entrance.value = 0;
    }
    return () => {
      cancelAnimation(entrance);
    };
  }, [entrance, visible]);

  // Seat-number pulse while waiting. 1.6s breath. Scoped to the one
  // element so it doesn't cause parent re-renders.
  const pulse = useSharedValue(1);
  useEffect(() => {
    if (phase === "waiting") {
      pulse.value = withRepeat(
        withTiming(0.45, {
          duration: 800,
          easing: Easing.inOut(Easing.quad),
        }),
        -1,
        true,
      );
    } else {
      cancelAnimation(pulse);
      pulse.value = withTiming(1, { duration: 180 });
    }
    return () => {
      cancelAnimation(pulse);
    };
  }, [phase, pulse]);

  const cardStyle = useAnimatedStyle(() => ({
    opacity: entrance.value,
    transform: [{ scale: 0.96 + entrance.value * 0.04 }],
  }));

  const numberStyle = useAnimatedStyle(() => ({
    opacity: pulse.value,
  }));

  // Start watching when the sheet enters "waiting" phase. Tears down
  // automatically on dismiss.
  useRoomCapacityWatcher({
    roomId,
    max,
    enabled: phase === "waiting",
    onSeatOpen,
  });

  const accent = isHost ? colors.accent : colors.primary;
  const accentFg = colors.primaryForeground;

  const handlePrimary = useCallback(() => {
    if (isHost) {
      onUpgrade();
      return;
    }
    if (phase === "idle") {
      onStartWaiting();
      return;
    }
    if (phase === "seat-open") {
      onSeatOpen();
    }
  }, [isHost, onSeatOpen, onStartWaiting, onUpgrade, phase]);

  const primaryLabel = isHost
    ? "Upgrade"
    : phase === "waiting"
      ? "Waiting…"
      : phase === "seat-open"
        ? "Seat open — tap to join"
        : "Notify me";

  const primaryDisabled = phase === "waiting";

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Animated.View
          style={[
            styles.card,
            {
              backgroundColor: colors.secondary,
              borderColor: colors.border,
            },
            cardStyle,
          ]}
        >
          {/* Icon halo — accent tint, 12% alpha fill. Signals whether
              this is an upsell moment (host) or a waiting moment (viewer). */}
          <View
            style={[
              styles.iconHalo,
              { backgroundColor: `${accent}1f`, borderColor: `${accent}40` },
            ]}
          >
            {isHost ? (
              <Crown size={26} color={accent} />
            ) : (
              <Users size={26} color={accent} />
            )}
          </View>

          {/* Hero seat counter — the number IS the copy. */}
          <View style={styles.seatRow}>
            <Animated.Text
              style={[styles.seatCount, { color: accent }, numberStyle]}
            >
              {current}
            </Animated.Text>
            <Text style={[styles.seatSeparator, { color: colors.mutedForeground }]}>
              /
            </Text>
            <Text style={[styles.seatCount, { color: colors.mutedForeground }]}>
              {max}
            </Text>
          </View>
          <Text style={[styles.seatLabel, { color: colors.mutedForeground }]}>
            seats taken
          </Text>

          {/* Headline + body. Tone is velvet-rope for both — confident
              upsell for host, warm wait for viewer. */}
          <Text style={[styles.title, { color: colors.foreground }]}>
            {isHost ? "Your room is full" : "It's popping in there"}
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            {isHost
              ? "You're at the seat limit on your current plan. Upgrade to host larger rooms."
              : phase === "seat-open"
                ? "A seat just opened. Grab it before someone else does."
                : phase === "waiting"
                  ? "We're watching the door. You'll slide in the moment a seat opens."
                  : "Every seat is taken right now. Tap notify and we'll slide you in when one opens."}
          </Text>

          {/* Primary CTA — accent-colored, full-width, single. */}
          <Pressable
            onPress={handlePrimary}
            disabled={primaryDisabled}
            style={({ pressed }) => [
              styles.primaryBtn,
              {
                backgroundColor: accent,
                opacity: primaryDisabled ? 0.7 : pressed ? 0.85 : 1,
              },
            ]}
          >
            {phase === "waiting" ? (
              <ActivityIndicator
                size="small"
                color={accentFg}
                style={{ marginRight: 8 }}
              />
            ) : phase === "seat-open" ? (
              <Check size={16} color={accentFg} style={{ marginRight: 6 }} />
            ) : null}
            <Text style={[styles.primaryLabel, { color: accentFg }]}>
              {primaryLabel}
            </Text>
          </Pressable>

          {/* Pay to join — only shown for viewers when paywall is available */}
          {!isHost && onPayToJoin && (
            <Pressable
              onPress={onPayToJoin}
              style={({ pressed }) => [
                styles.secondaryBtn,
                {
                  borderColor: accent,
                  backgroundColor: `${accent}18`,
                  opacity: pressed ? 0.7 : 1,
                  marginBottom: 8,
                },
              ]}
            >
              <Text style={[styles.secondaryLabel, { color: accent }]}>
                Pay $2.99 to join now
              </Text>
            </Pressable>
          )}

          {/* Secondary — hairline close. */}
          <Pressable
            onPress={onClose}
            style={({ pressed }) => [
              styles.secondaryBtn,
              {
                borderColor: colors.border,
                opacity: pressed ? 0.7 : 1,
              },
            ]}
          >
            <Text
              style={[styles.secondaryLabel, { color: colors.foreground }]}
            >
              Close
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.78)",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  card: {
    width: "100%",
    maxWidth: 380,
    borderRadius: 22,
    borderWidth: StyleSheet.hairlineWidth,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 18,
    alignItems: "center",
  },
  iconHalo: {
    width: 60,
    height: 60,
    borderRadius: 18,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 16,
  },
  seatRow: {
    flexDirection: "row",
    alignItems: "baseline",
    gap: 6,
  },
  seatCount: {
    fontSize: 44,
    fontWeight: "800",
    letterSpacing: -1.2,
  },
  seatSeparator: {
    fontSize: 32,
    fontWeight: "300",
  },
  seatLabel: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 1.2,
    marginTop: 2,
    marginBottom: 14,
  },
  title: {
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 6,
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
    marginBottom: 18,
    paddingHorizontal: 4,
  },
  primaryBtn: {
    width: "100%",
    height: 48,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    flexDirection: "row",
    marginBottom: 8,
  },
  primaryLabel: {
    fontSize: 15,
    fontWeight: "700",
    letterSpacing: 0.2,
  },
  secondaryBtn: {
    width: "100%",
    height: 44,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
  },
  secondaryLabel: {
    fontSize: 14,
    fontWeight: "600",
    letterSpacing: 0.1,
  },
});
