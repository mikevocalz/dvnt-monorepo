/**
 * CaptureNotificationBanner
 *
 * Top-of-room notification surface for "someone just captured the room"
 * events. Driven by `useSneakyLynkCaptureStore`. Two phases:
 *
 *   - Self: "You took a screenshot — everyone here was notified."
 *           (DVNT primary cyan tint — confirming the user's own action)
 *   - Other: "[Name] took a screenshot" (DVNT destructive red tint —
 *            privacy-sensitive signal, but not accusatory wording)
 *
 * Design (per the frontend-design skill direction):
 *   - Neutral-direct copy. No "caught you!", no "oops!". Plain fact.
 *   - Drops from under the status bar with a spring, fades on dismiss.
 *   - Self/other distinction is purely color — the structure is the
 *     same so the room learns to recognize the surface regardless of
 *     role.
 *   - 6-second auto-dismiss for screenshots (matched to store timeout).
 *     Recording events stay persistent (driven upstream when we add
 *     recording detection).
 */

import { useEffect } from "react";
import { Text, View, StyleSheet, Platform } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  Easing,
  runOnJS,
  cancelAnimation,
} from "react-native-reanimated";
import { Camera, CircleDot } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useColorScheme } from "@/lib/hooks";
import { useSneakyLynkCaptureStore } from "@/lib/stores/sneaky-lynk-capture-store";

export function CaptureNotificationBanner() {
  const insets = useSafeAreaInsets();
  const { colors } = useColorScheme();
  const current = useSneakyLynkCaptureStore((s) => s.currentCapture);
  const clearCapture = useSneakyLynkCaptureStore((s) => s.clearCapture);

  const translateY = useSharedValue(-120);
  const opacity = useSharedValue(0);

  useEffect(() => {
    if (current) {
      translateY.value = withSpring(0, { damping: 18, stiffness: 240 });
      opacity.value = withTiming(1, { duration: 180 });
    } else {
      opacity.value = withTiming(0, { duration: 180 });
      translateY.value = withTiming(
        -120,
        { duration: 220, easing: Easing.in(Easing.cubic) },
        (finished) => {
          if (finished) runOnJS(clearCapture)();
        },
      );
    }
    return () => {
      cancelAnimation(translateY);
      cancelAnimation(opacity);
    };
  }, [current, translateY, opacity, clearCapture]);

  const animatedStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
    transform: [{ translateY: translateY.value }],
  }));

  if (!current) return null;

  // Self = cyan (confirming your own action). Other = red (privacy
  // signal — someone captured you). Recording uses the same red with
  // a live indicator chip appended.
  const isRecording =
    current.kind === "recording_start" || current.kind === "recording_stop";
  const tintFill = current.isSelf
    ? `${colors.primary}1f`
    : `${colors.destructive}1f`;
  const tintBorder = current.isSelf
    ? `${colors.primary}66`
    : `${colors.destructive}66`;
  const iconColor = current.isSelf ? colors.primary : colors.destructive;

  const title = current.isSelf
    ? isRecording && current.kind === "recording_start"
      ? "You're recording"
      : "You took a screenshot"
    : isRecording && current.kind === "recording_start"
      ? `${current.actorUsername} is recording`
      : `${current.actorUsername} took a screenshot`;

  const body = current.isSelf
    ? "Everyone in the room was notified."
    : "The room was notified.";

  return (
    <Animated.View
      pointerEvents="none"
      style={[
        styles.wrapper,
        { paddingTop: insets.top + 6 },
        animatedStyle,
      ]}
    >
      <View
        style={[
          styles.pill,
          {
            backgroundColor: `${colors.secondary}f0`,
            borderColor: tintBorder,
          },
        ]}
      >
        <View
          style={[
            styles.iconHalo,
            { backgroundColor: tintFill, borderColor: tintBorder },
          ]}
        >
          {isRecording && current.kind === "recording_start" ? (
            <CircleDot size={15} color={iconColor} />
          ) : (
            <Camera size={15} color={iconColor} />
          )}
        </View>
        <View style={styles.textColumn}>
          <Text style={[styles.title, { color: colors.foreground }]}>
            {title}
          </Text>
          <Text style={[styles.body, { color: colors.mutedForeground }]}>
            {body}
          </Text>
        </View>
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 4500,
    elevation: Platform.OS === "android" ? 25 : 0,
    paddingHorizontal: 16,
  },
  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingLeft: 10,
    paddingRight: 16,
    paddingVertical: 10,
    borderRadius: 16,
    borderWidth: StyleSheet.hairlineWidth,
    minWidth: 240,
    maxWidth: "94%",
    shadowColor: "#000",
    shadowOpacity: 0.38,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  iconHalo: {
    width: 32,
    height: 32,
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  textColumn: {
    flex: 1,
    minWidth: 0,
  },
  title: {
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.1,
  },
  body: {
    fontSize: 11,
    fontWeight: "500",
    letterSpacing: 0.1,
    marginTop: 2,
  },
});
