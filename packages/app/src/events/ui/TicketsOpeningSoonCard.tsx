import React, { memo, useEffect, useMemo, useState } from "react";
import { View, Text, Pressable, StyleSheet, Platform } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { Motion } from "@legendapp/motion";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  interpolate,
} from "react-native-reanimated";
import { BellRing, BellOff, CalendarPlus } from "lucide-react-native";

interface TicketsOpeningSoonCardProps {
  /** ISO string for when ticket sales open. If null, no countdown is shown. */
  saleStart: string | null;
  /** True if the current user has opted in to be notified when sales open. */
  notifyEnabled: boolean;
  /** Toggle the notify subscription. */
  onToggleNotify: () => void;
  /** Add the sale-open moment to the user's calendar. */
  onAddToCalendar?: () => void;
  /** Optional: glow color, defaults to brand purple. */
  glowColor?: string;
}

type Countdown =
  | { kind: "future"; days: number; hours: number; minutes: number; seconds: number }
  | { kind: "open" }
  | { kind: "unknown" };

function compute(saleStart: string | null): Countdown {
  if (!saleStart) return { kind: "unknown" };
  const t = new Date(saleStart).getTime();
  if (isNaN(t)) return { kind: "unknown" };
  const diff = t - Date.now();
  if (diff <= 0) return { kind: "open" };
  return {
    kind: "future",
    days: Math.floor(diff / (1000 * 60 * 60 * 24)),
    hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
    minutes: Math.floor((diff / (1000 * 60)) % 60),
    seconds: Math.floor((diff / 1000) % 60),
  };
}

function formatSaleDate(iso: string): string {
  try {
    const d = new Date(iso);
    const date = d.toLocaleDateString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
    });
    const time = d.toLocaleTimeString("en-US", {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    });
    return `${date} · ${time}`;
  } catch {
    return "";
  }
}

export const TicketsOpeningSoonCard = memo(function TicketsOpeningSoonCard({
  saleStart,
  notifyEnabled,
  onToggleNotify,
  onAddToCalendar,
  glowColor = "#8A40CF",
}: TicketsOpeningSoonCardProps) {
  const [countdown, setCountdown] = useState<Countdown>(() => compute(saleStart));

  useEffect(() => {
    const tick = () => setCountdown(compute(saleStart));
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [saleStart]);

  // Pulse the bell when not yet subscribed — invites tap.
  const pulse = useSharedValue(0);
  useEffect(() => {
    pulse.value = notifyEnabled
      ? withTiming(0, { duration: 300 })
      : withRepeat(
          withSequence(
            withTiming(1, { duration: 1100 }),
            withTiming(0, { duration: 1100 }),
          ),
          -1,
          true,
        );
  }, [notifyEnabled, pulse]);

  const bellStyle = useAnimatedStyle(() => ({
    transform: [{ scale: interpolate(pulse.value, [0, 1], [1, 1.08]) }],
    opacity: interpolate(pulse.value, [0, 1], [0.85, 1]),
  }));

  const countdownText = useMemo(() => {
    if (countdown.kind === "open") return "Sales open now";
    if (countdown.kind === "unknown") return "Tickets coming soon";
    const { days: d, hours: h, minutes: m, seconds: s } = countdown;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  }, [countdown]);

  const subline = useMemo(() => {
    if (countdown.kind === "open") return "Tap Get Tickets to grab yours";
    if (countdown.kind === "unknown")
      return "We'll let you know the moment sales open";
    return saleStart ? formatSaleDate(saleStart) : "";
  }, [countdown.kind, saleStart]);

  return (
    <Motion.View
      initial={{ opacity: 0, translateY: 8 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: "spring", damping: 24, stiffness: 220 }}
      style={styles.wrapper}
    >
      <LinearGradient
        colors={[
          "rgba(138,64,207,0.22)",
          "rgba(138,64,207,0.06)",
          "rgba(20,16,32,0.85)",
        ]}
        locations={[0, 0.55, 1]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.card}
      >
        {/* Top row: bell + label */}
        <View style={styles.headerRow}>
          <Animated.View style={[styles.bellWrap, bellStyle]}>
            <View
              style={[
                styles.bellHalo,
                { backgroundColor: `${glowColor}22`, borderColor: `${glowColor}55` },
              ]}
            >
              {notifyEnabled ? (
                <BellRing size={18} color={glowColor} />
              ) : (
                <BellOff size={18} color="rgba(255,255,255,0.7)" />
              )}
            </View>
          </Animated.View>
          <View style={{ flex: 1 }}>
            <Text style={styles.eyebrow}>SALE STARTS</Text>
            <Text style={styles.countdown}>{countdownText}</Text>
            {!!subline && <Text style={styles.subline}>{subline}</Text>}
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Pressable
            onPress={onToggleNotify}
            style={({ pressed }) => [
              styles.primaryAction,
              {
                backgroundColor: notifyEnabled
                  ? "rgba(34,197,94,0.18)"
                  : glowColor,
                borderColor: notifyEnabled
                  ? "rgba(34,197,94,0.45)"
                  : "transparent",
                borderWidth: notifyEnabled ? 1 : 0,
                opacity: pressed ? 0.85 : 1,
              },
            ]}
            accessibilityRole="button"
            accessibilityLabel={
              notifyEnabled ? "Turn off sale reminder" : "Notify me when sales open"
            }
          >
            {notifyEnabled ? (
              <BellRing size={16} color="#22c55e" />
            ) : (
              <BellRing size={16} color="#000" />
            )}
            <Text
              style={[
                styles.primaryActionText,
                { color: notifyEnabled ? "#22c55e" : "#000" },
              ]}
            >
              {notifyEnabled ? "We'll remind you" : "Notify me"}
            </Text>
          </Pressable>

          {onAddToCalendar && (
            <Pressable
              onPress={onAddToCalendar}
              style={({ pressed }) => [
                styles.secondaryAction,
                { opacity: pressed ? 0.7 : 1 },
              ]}
              accessibilityRole="button"
              accessibilityLabel="Add sale start to calendar"
              hitSlop={8}
            >
              <CalendarPlus size={16} color="rgba(255,255,255,0.85)" />
            </Pressable>
          )}
        </View>
      </LinearGradient>
    </Motion.View>
  );
});

const styles = StyleSheet.create({
  wrapper: {
    marginHorizontal: 20,
    marginTop: 10,
    marginBottom: 6,
  },
  card: {
    borderRadius: 20,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(138,64,207,0.28)",
    ...Platform.select({
      ios: {
        shadowColor: "#8A40CF",
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.18,
        shadowRadius: 18,
      },
      android: { elevation: 6 },
    }),
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 14,
    marginBottom: 14,
  },
  bellWrap: {
    width: 44,
    height: 44,
  },
  bellHalo: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
  },
  eyebrow: {
    color: "rgba(255,255,255,0.55)",
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1.2,
  },
  countdown: {
    color: "#fff",
    fontSize: 22,
    fontWeight: "800",
    letterSpacing: 0.2,
    marginTop: 2,
  },
  subline: {
    color: "rgba(255,255,255,0.65)",
    fontSize: 13,
    fontWeight: "500",
    marginTop: 2,
  },
  actions: {
    flexDirection: "row",
    gap: 10,
    alignItems: "stretch",
  },
  primaryAction: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 12,
    borderRadius: 14,
  },
  primaryActionText: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.2,
  },
  secondaryAction: {
    width: 44,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.12)",
  },
});
