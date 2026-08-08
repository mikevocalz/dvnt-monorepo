import React, { memo, useCallback, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { ChevronDown } from "lucide-react-native";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  interpolate,
} from "react-native-reanimated";

interface CollapsibleRowProps {
  icon: string;
  title: string;
  content: string | string[];
}

export const CollapsibleRow = memo(function CollapsibleRow({
  icon,
  title,
  content,
}: CollapsibleRowProps) {
  const [expanded, setExpanded] = useState(false);
  const progress = useSharedValue(0);

  const toggle = useCallback(() => {
    setExpanded((prev) => !prev);
    progress.value = withTiming(expanded ? 0 : 1, { duration: 250 });
  }, [expanded, progress]);

  const chevronStyle = useAnimatedStyle(() => ({
    transform: [
      { rotate: `${interpolate(progress.value, [0, 1], [0, 180])}deg` },
    ],
  }));

  const contentStyle = useAnimatedStyle(() => ({
    opacity: progress.value,
    maxHeight: interpolate(progress.value, [0, 1], [0, 300]),
  }));

  const contentArray = Array.isArray(content) ? content : [content];

  return (
    <View style={styles.container}>
      <Pressable onPress={toggle} style={styles.header}>
        <Text style={styles.icon}>{icon}</Text>
        <Text style={styles.title}>{title}</Text>
        <Animated.View style={chevronStyle}>
          <ChevronDown size={18} color="#34A2DF" />
        </Animated.View>
      </Pressable>

      <Animated.View style={[styles.body, contentStyle]}>
        {expanded && (
          <View style={styles.contentInner}>
            {contentArray.map((item, i) => (
              <Text key={i} style={styles.contentText}>
                {contentArray.length > 1 ? `\u2022 ${item}` : item}
              </Text>
            ))}
          </View>
        )}
      </Animated.View>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    backgroundColor: "rgba(138,64,207,0.06)",
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(138,64,207,0.12)",
    overflow: "hidden",
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    gap: 10,
  },
  icon: {
    fontSize: 18,
  },
  title: {
    flex: 1,
    color: "#fff",
    fontSize: 15,
    fontWeight: "600",
  },
  body: {
    overflow: "hidden",
  },
  contentInner: {
    paddingHorizontal: 14,
    paddingBottom: 14,
    paddingTop: 0,
    gap: 4,
  },
  contentText: {
    color: "rgba(255,255,255,0.6)",
    fontSize: 14,
    lineHeight: 20,
  },
});
