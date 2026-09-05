/**
 * TagBubble — Instagram-style tag bubble with anchor dot.
 * Used by both TagOverlayViewer (feed/detail) and TagOverlayEditor (create/edit).
 *
 * Visual spec (mandatory):
 *   borderWidth: 1, borderColor: #FF5BFC
 *   backgroundColor: rgba(0,0,0,0.72), borderRadius: 18
 *   paddingHorizontal: 10, paddingVertical: 4
 *   Text color: white
 *   Anchor dot: 6px, filled #FF5BFC
 */

import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Animated, {
  useAnimatedStyle,
  withSpring,
  withTiming,
  type SharedValue,
} from "react-native-reanimated";

interface TagBubbleProps {
  username: string;
  /** 0–1 normalized x within parent image bounds */
  x: number;
  /** 0–1 normalized y within parent image bounds */
  y: number;
  /** Reanimated shared value driving show/hide animation */
  progress: SharedValue<number>;
  onPress?: () => void;
  onLongPress?: () => void;
}

export const TagBubble: React.FC<TagBubbleProps> = React.memo(
  ({ username, x, y, progress, onPress, onLongPress }) => {
    const animatedStyle = useAnimatedStyle(() => {
      return {
        opacity: progress.value,
        transform: [
          { scale: 0.96 + progress.value * 0.04 }, // 0.96 → 1
        ],
      };
    });

    // Position the bubble centered on the tag point
    // Anchor dot sits at (x%, y%), bubble floats above
    return (
      <Animated.View
        style={[
          styles.container,
          {
            left: `${x * 100}%`,
            top: `${y * 100}%`,
          },
          animatedStyle,
        ]}
        pointerEvents={progress.value > 0.1 ? "auto" : "none"}
      >
        {/* Anchor dot */}
        <View style={styles.anchorDot} />

        {/* Bubble */}
        <Pressable
          onPress={onPress}
          onLongPress={onLongPress}
          style={styles.bubble}
          hitSlop={8}
        >
          <Text style={styles.username} numberOfLines={1}>
            {username}
          </Text>
        </Pressable>
      </Animated.View>
    );
  },
);

TagBubble.displayName = "TagBubble";

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    alignItems: "center",
    // Offset so anchor dot is at the exact coordinate
    transform: [{ translateX: -3 }, { translateY: -3 }],
  },
  anchorDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: "#FF5BFC",
    marginBottom: 4,
  },
  bubble: {
    backgroundColor: "rgba(0,0,0,0.72)",
    borderWidth: 1,
    borderColor: "#FF5BFC",
    borderRadius: 18,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: 160,
  },
  username: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "600",
  },
});
