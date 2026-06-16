import React, { memo, useEffect } from "react";
import { View, StyleSheet, Dimensions } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withTiming,
  interpolate,
} from "react-native-reanimated";

const { width: SCREEN_WIDTH } = Dimensions.get("window");

function ShimmerBlock({
  width,
  height,
  borderRadius = 8,
  style,
}: {
  width: number | string;
  height: number;
  borderRadius?: number;
  style?: any;
}) {
  const shimmer = useSharedValue(0);

  useEffect(() => {
    shimmer.value = withRepeat(withTiming(1, { duration: 1200 }), -1, true);
  }, [shimmer]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: interpolate(shimmer.value, [0, 1], [0.08, 0.16]),
  }));

  return (
    <Animated.View
      style={[
        {
          width: width as any,
          height,
          borderRadius,
          backgroundColor: "#fff",
        },
        animatedStyle,
        style,
      ]}
    />
  );
}

export const EventDetailSkeleton = memo(function EventDetailSkeleton() {
  return (
    <View style={styles.container}>
      {/* Hero */}
      <ShimmerBlock width={SCREEN_WIDTH} height={420} borderRadius={0} />

      {/* Content */}
      <View style={styles.content}>
        {/* Chips */}
        <View style={styles.chipRow}>
          <ShimmerBlock width={60} height={28} borderRadius={14} />
          <ShimmerBlock width={100} height={28} borderRadius={14} />
          <ShimmerBlock width={80} height={28} borderRadius={14} />
        </View>

        {/* Title */}
        <ShimmerBlock width="85%" height={32} borderRadius={6} style={{ marginBottom: 8 }} />
        <ShimmerBlock width="60%" height={32} borderRadius={6} style={{ marginBottom: 20 }} />

        {/* Venue + host */}
        <ShimmerBlock width="50%" height={18} borderRadius={4} style={{ marginBottom: 6 }} />
        <View style={styles.hostRow}>
          <ShimmerBlock width={28} height={28} borderRadius={14} />
          <ShimmerBlock width={120} height={16} borderRadius={4} />
        </View>

        {/* Social proof */}
        <ShimmerBlock width="100%" height={60} borderRadius={16} style={{ marginTop: 20 }} />

        {/* Collapsible rows */}
        <View style={{ gap: 8, marginTop: 24 }}>
          <ShimmerBlock width="100%" height={48} borderRadius={14} />
          <ShimmerBlock width="100%" height={48} borderRadius={14} />
          <ShimmerBlock width="100%" height={48} borderRadius={14} />
        </View>

        {/* Ticket tiers */}
        <View style={styles.tierRow}>
          <ShimmerBlock width={200} height={220} borderRadius={20} />
          <ShimmerBlock width={200} height={220} borderRadius={20} />
        </View>
      </View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: "#000",
  },
  content: {
    padding: 20,
    marginTop: -40,
  },
  chipRow: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 16,
  },
  hostRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    marginBottom: 8,
  },
  tierRow: {
    flexDirection: "row",
    gap: 12,
    marginTop: 24,
  },
});
