/**
 * Room Timer Component
 * Free Sneaky Lynk duration timer. Shows countdown in the last 60 seconds.
 * Auto-triggers onTimeUp when timer hits 0.
 */

import { View, Text, Animated, Easing } from "react-native";
import { useEffect, useRef, useState, useCallback } from "react";
import { Clock } from "lucide-react-native";

export const FREE_ROOM_DURATION_MS = 5 * 60 * 1000; // 5 minutes
const COUNTDOWN_THRESHOLD_MS = 60 * 1000; // Show countdown in last 60s

interface RoomTimerProps {
  /** Called when the timer reaches 0 */
  onTimeUp: () => void;
  /** Timestamp when the room started (defaults to mount time) */
  startedAt?: number;
  /** Duration before the timer expires */
  durationMs?: number;
}

export function RoomTimer({
  onTimeUp,
  startedAt,
  durationMs = FREE_ROOM_DURATION_MS,
}: RoomTimerProps) {
  const mountTime = useRef(startedAt ?? Date.now()).current;
  const [remainingMs, setRemainingMs] = useState(() =>
    Math.max(0, durationMs - (Date.now() - mountTime)),
  );
  const onTimeUpRef = useRef(onTimeUp);
  onTimeUpRef.current = onTimeUp;
  const hasEnded = useRef(false);

  // Pulse animation for the countdown badge
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const interval = setInterval(() => {
      const elapsed = Date.now() - mountTime;
      const remaining = Math.max(0, durationMs - elapsed);
      setRemainingMs(remaining);

      if (remaining <= 0 && !hasEnded.current) {
        hasEnded.current = true;
        clearInterval(interval);
        onTimeUpRef.current();
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [durationMs, mountTime]);

  // Start pulse when countdown is visible
  const showCountdown =
    remainingMs <= COUNTDOWN_THRESHOLD_MS && remainingMs > 0;

  useEffect(() => {
    if (!showCountdown) return;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.1,
          duration: 500,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 500,
          easing: Easing.in(Easing.ease),
          useNativeDriver: true,
        }),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [showCountdown, pulseAnim]);

  if (!showCountdown) return null;

  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const display = `${minutes}:${seconds.toString().padStart(2, "0")}`;

  return (
    <Animated.View
      style={{
        transform: [{ scale: pulseAnim }],
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 6,
          backgroundColor: "rgba(252, 37, 58, 0.9)",
          paddingHorizontal: 10,
          paddingVertical: 7,
          borderRadius: 10,
        }}
      >
        <Clock size={14} color="#fff" />
        <Text style={{ color: "#fff", fontSize: 13, fontWeight: "700" }}>
          {display}
        </Text>
      </View>
    </Animated.View>
  );
}
