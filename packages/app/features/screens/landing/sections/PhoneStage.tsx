/**
 * Phone stage — PHASE 1 PLACEHOLDER.
 *
 * A static, glass-framed phone showing a mini DVNT shell, floating gently off
 * the section's scroll progress. Phase 2 swaps this for the pinned WebGPU +
 * three.js 3D phone with a live RN-view projected onto the screen plane (see
 * docs/landing-page-notes.md). Built so that swap touches only this file.
 */
import { Platform, StyleSheet, View } from "react-native";
import { Section } from "@expo/html-elements";
import Animated, {
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import { useLandingScroll, useSectionProgress } from "../hooks/useScrollProgress";
import { LANDING_COLORS, LANDING_GRADIENTS } from "../theme";

const SCREEN_BG =
  Platform.OS === "web"
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ backgroundImage: LANDING_GRADIENTS.deviantCss } as any)
    : { backgroundColor: LANDING_COLORS.purple };

export function PhoneStage() {
  const { reduceMotion } = useLandingScroll();
  const { onLayout, progress, enter } = useSectionProgress();

  const floatStyle = useAnimatedStyle(
    () => ({
      opacity: enter.value,
      transform: reduceMotion.value
        ? []
        : [
            { translateY: interpolate(progress.value, [0, 1], [60, -60]) },
            { rotateZ: `${interpolate(progress.value, [0, 1], [-3, 3])}deg` },
          ],
    }),
    [enter, progress, reduceMotion],
  );

  return (
    <Section onLayout={onLayout} style={styles.section}>
      <Animated.Text style={styles.kicker}>The room, in your pocket</Animated.Text>
      <Animated.Text style={styles.caption}>
        Feed, events, and rooms — one tap from the door.
      </Animated.Text>

      <Animated.View style={[styles.phone, floatStyle]}>
        <View style={[styles.screen, SCREEN_BG]}>
          <View style={styles.notch} />
          <View style={styles.cardLg} />
          <View style={styles.row}>
            <View style={styles.cardSm} />
            <View style={styles.cardSm} />
          </View>
          <View style={styles.cardMd} />
          <View style={styles.tabbar} />
        </View>
      </Animated.View>
    </Section>
  );
}

const styles = StyleSheet.create({
  section: {
    minHeight: 760,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 90,
    backgroundColor: "transparent",
    overflow: "hidden",
  },
  kicker: {
    color: LANDING_COLORS.cyan,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  caption: {
    color: LANDING_COLORS.textSecondary,
    fontSize: 20,
    marginTop: 10,
    marginBottom: 44,
    textAlign: "center",
  },
  phone: {
    width: 280,
    height: 580,
    borderRadius: 46,
    padding: 12,
    backgroundColor: "#0A0A12",
    borderWidth: 1,
    borderColor: LANDING_COLORS.glassBorderStrong,
    // boxShadow is supported on RN 0.85 + react-native-web (avoids the
    // deprecated shadow* props warning).
    boxShadow: "0px 24px 60px rgba(138,64,207,0.5)",
  },
  screen: {
    flex: 1,
    borderRadius: 36,
    padding: 16,
    overflow: "hidden",
    alignItems: "stretch",
  },
  notch: {
    width: 90,
    height: 7,
    borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.35)",
    alignSelf: "center",
    marginBottom: 18,
  },
  cardLg: {
    height: 150,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.16)",
    marginBottom: 12,
  },
  row: { flexDirection: "row", gap: 12, marginBottom: 12 },
  cardSm: {
    flex: 1,
    height: 84,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.12)",
  },
  cardMd: {
    height: 110,
    borderRadius: 16,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  tabbar: {
    height: 46,
    borderRadius: 16,
    backgroundColor: "rgba(0,0,0,0.30)",
    marginTop: "auto",
  },
});
