/**
 * Hero copy + kinetic entrance — NATIVE (web resolves HeroContent.web.tsx).
 * Words fade/rise in on mount via a worklet timeline (mount-driven shared
 * values rather than layout-animation `entering`).
 */
import { useEffect } from "react";
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { useRouter } from "solito/navigation";
import { H1, P } from "@dvnt/app/components/ui/html";
import Animated, {
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { LANDING_COLORS, LANDING_GRADIENTS } from "../theme";
import { EASE_SETTLE } from "../theme-motion";

const WORDS = ["connect.", "gather.", "move."];

// NATIVE-ONLY: web resolves HeroContent.web.tsx (static, no Reanimated —
// DVNT-WEB-6). Native keeps the worklet entrance from opacity 0.
const REST_VISIBLE = 0;

function Word({ text, index }: { text: string; index: number }) {
  const t = useSharedValue(REST_VISIBLE);
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
  const router = useRouter();
  const fade = useSharedValue(REST_VISIBLE);
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
            onPress={() => router.push("/auth/login")}
            style={styles.primary}
          >
            <Animated.Text style={styles.primaryText}>
              Sign-Up / Sign-In
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
});
