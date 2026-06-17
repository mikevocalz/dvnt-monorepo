/**
 * Shared hero copy + kinetic entrance, used by both Hero.web and Hero.native.
 * Words fade/rise in on mount via a worklet timeline (mount-driven shared
 * values rather than layout-animation `entering`, which is flaky on RN-web).
 */
import { useEffect } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { H1, P } from "@expo/html-elements";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { EASE_SETTLE, LANDING_COLORS, LANDING_GRADIENTS } from "../theme";

const WORDS = ["connect.", "gather.", "move."];

function scrollToSection(id: string) {
  if (Platform.OS !== "web") return;
  const target = (globalThis as typeof globalThis & {
    document?: Document;
  }).document?.getElementById(id);
  target?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function Word({ text, index }: { text: string; index: number }) {
  const t = useSharedValue(0);
  useEffect(() => {
    t.value = withDelay(
      200 + index * 140,
      withTiming(1, { duration: 620, easing: EASE_SETTLE }),
    );
  }, [t, index]);

  const style = useAnimatedStyle(
    () => ({
      opacity: t.value,
      transform: [{ translateY: (1 - t.value) * 22 }],
    }),
    [t],
  );

  return (
    <Animated.Text style={[styles.word, style]}>
      {text}
      {index < WORDS.length - 1 ? " " : ""}
    </Animated.Text>
  );
}

export function HeroContent() {
  const fade = useSharedValue(0);
  useEffect(() => {
    fade.value = withDelay(
      560,
      withTiming(1, { duration: 700, easing: EASE_SETTLE }),
    );
  }, [fade]);

  const fadeStyle = useAnimatedStyle(
    () => ({
      opacity: fade.value,
      transform: [{ translateY: (1 - fade.value) * 16 }],
    }),
    [fade],
  );

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <H1 style={styles.h1}>
        {WORDS.map((w, i) => (
          <Word key={w} text={w} index={i} />
        ))}
      </H1>

      <Animated.View style={fadeStyle}>
        <P style={styles.sub}>
          An intentional space for queer people to connect, gather, and move
          culture on their own terms. If you know, you know.
        </P>

        <View style={styles.cta}>
          <Pressable
            accessibilityRole="link"
            onPress={() => scrollToSection("download")}
            style={styles.primary}
          >
            <Animated.Text style={styles.primaryText}>
              Get the app
            </Animated.Text>
          </Pressable>
          <Pressable
            accessibilityRole="link"
            onPress={() => scrollToSection("explore")}
            style={styles.ghost}
          >
            <Animated.Text style={styles.ghostText}>
              Explore the room
            </Animated.Text>
          </Pressable>
        </View>
      </Animated.View>
    </View>
  );
}

const GRADIENT_STYLE =
  Platform.OS === "web"
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ backgroundImage: LANDING_GRADIENTS.deviantCss } as any)
    : { backgroundColor: LANDING_COLORS.purple };

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    paddingHorizontal: 24,
    maxWidth: 920,
    alignSelf: "center",
  },
  h1: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    textAlign: "center",
    margin: 0,
  },
  word: {
    color: LANDING_COLORS.text,
    fontSize: 60,
    lineHeight: 66,
    fontWeight: "800",
    letterSpacing: -1.5,
  },
  sub: {
    color: LANDING_COLORS.textSecondary,
    fontSize: 19,
    lineHeight: 28,
    textAlign: "center",
    marginTop: 20,
    maxWidth: 620,
    alignSelf: "center",
  },
  cta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    justifyContent: "center",
    marginTop: 30,
  },
  primary: {
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 12,
    ...GRADIENT_STYLE,
  },
  primaryText: { color: "#0A0118", fontWeight: "800", fontSize: 16 },
  ghost: {
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: LANDING_COLORS.glassBorderStrong,
  },
  ghostText: { color: LANDING_COLORS.text, fontWeight: "700", fontSize: 16 },
});
