import React, { useEffect, useState, memo } from "react";
import { View, Text, StyleSheet } from "react-native";

interface CountdownTimerProps {
  targetDate: string;
  endDate?: string;
}

type TimerState =
  | {
      status: "countdown";
      days: number;
      hours: number;
      minutes: number;
      seconds: number;
    }
  | { status: "live" }
  | { status: "ended" };

const FALLBACK_DURATION_MS = 24 * 60 * 60 * 1000; // 24h default if no endDate

function computeState(startStr: string, endStr?: string): TimerState {
  const now = Date.now();
  const start = new Date(startStr).getTime();

  // If start date is invalid, treat as ended to avoid false "LIVE NOW"
  if (isNaN(start)) return { status: "ended" };

  // Future → countdown
  if (start > now) {
    const diff = start - now;
    return {
      status: "countdown",
      days: Math.floor(diff / (1000 * 60 * 60 * 24)),
      hours: Math.floor((diff / (1000 * 60 * 60)) % 24),
      minutes: Math.floor((diff / (1000 * 60)) % 60),
      seconds: Math.floor((diff / 1000) % 60),
    };
  }

  // Started — check if ended
  const end = endStr ? new Date(endStr).getTime() : NaN;
  const effectiveEnd = isNaN(end) ? start + FALLBACK_DURATION_MS : end;

  if (now < effectiveEnd) {
    return { status: "live" };
  }

  return { status: "ended" };
}

function formatUnit(value: number, label: string) {
  return `${value}${label}`;
}

export const CountdownTimer = memo(function CountdownTimer({
  targetDate,
  endDate,
}: CountdownTimerProps) {
  const [state, setState] = useState(() => computeState(targetDate, endDate));

  useEffect(() => {
    const interval = setInterval(() => {
      const s = computeState(targetDate, endDate);
      setState(s);
      if (s.status === "ended") clearInterval(interval);
    }, 1000);
    return () => clearInterval(interval);
  }, [targetDate, endDate]);

  if (state.status === "ended") {
    return (
      <View style={styles.chip}>
        <Text style={styles.endedText}>Event Ended</Text>
      </View>
    );
  }

  if (state.status === "live") {
    return (
      <View style={[styles.chip, styles.liveChip]}>
        <Text style={styles.liveText}>LIVE NOW</Text>
      </View>
    );
  }

  const parts: string[] = [];
  if (state.days > 0) parts.push(formatUnit(state.days, "d"));
  parts.push(formatUnit(state.hours, "h"));
  parts.push(formatUnit(state.minutes, "m"));
  if (state.days === 0) parts.push(formatUnit(state.seconds, "s"));

  return (
    <View style={styles.chip}>
      <Text style={styles.text}>Starts in {parts.join(" ")}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  chip: {
    backgroundColor: "rgba(63,220,255,0.1)",
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: "rgba(63,220,255,0.2)",
  },
  text: {
    color: "#3FDCFF",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
  liveChip: {
    backgroundColor: "rgba(252,37,58,0.15)",
    borderColor: "rgba(252,37,58,0.3)",
  },
  liveText: {
    color: "#FC253A",
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  endedText: {
    color: "#737373",
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 0.3,
  },
});
