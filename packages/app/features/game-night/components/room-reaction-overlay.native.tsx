import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import {
  subscribeRoomReactions,
  type RoomReactionEvent,
} from "../motion/room-reactions";

const TTL_MS = 1700;
const MAX_VISIBLE = 7;

function ReactionBubble({ event }: { event: RoomReactionEvent }) {
  const progress = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(progress, {
      toValue: 1,
      duration: TTL_MS,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [progress]);

  const translateY = progress.interpolate({
    inputRange: [0, 0.15, 1],
    outputRange: [18, 0, -180],
  });
  const opacity = progress.interpolate({
    inputRange: [0, 0.12, 0.75, 1],
    outputRange: [0, 1, 0.95, 0],
  });
  const scale = progress.interpolate({
    inputRange: [0, 0.18, 1],
    outputRange: [0.72, 1.12, 0.94],
  });

  return (
    <Animated.View
      style={[
        styles.bubble,
        {
          right: 8 + event.lane * 24,
          opacity,
          transform: [{ translateY }, { scale }],
        },
      ]}
    >
      <Text style={styles.emoji}>{event.emoji}</Text>
    </Animated.View>
  );
}

/**
 * Native fallback for the authored Room Reactions Rive artboard.
 * Transport/event semantics are final; the visual layer swaps to Rive once
 * game-night-hud.riv + the validated native runtime are in the repo.
 */
export function RoomReactionOverlay({ roomId }: { roomId: number }) {
  const [events, setEvents] = useState<RoomReactionEvent[]>([]);

  useEffect(
    () =>
      subscribeRoomReactions((event) => {
        if (event.roomId !== roomId) return;
        setEvents((current) => [...current, event].slice(-MAX_VISIBLE));
        const timer = setTimeout(() => {
          setEvents((current) => current.filter((item) => item.id !== event.id));
        }, TTL_MS);
        return () => clearTimeout(timer);
      }),
    [roomId],
  );

  return (
    <View pointerEvents="none" style={styles.layer}>
      {events.map((event) => (
        <ReactionBubble key={event.id} event={event} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  layer: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 80,
    overflow: "hidden",
  },
  bubble: {
    position: "absolute",
    bottom: 120,
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(11,12,19,0.78)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255,255,255,0.14)",
  },
  emoji: {
    fontSize: 28,
  },
});
