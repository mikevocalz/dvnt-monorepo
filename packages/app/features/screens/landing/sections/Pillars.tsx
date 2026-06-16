/**
 * Four pillar sections. Each layers a glow + index + headline + body that
 * translate at distinct rates off the section's own progress (derived from the
 * single shared scrollOffset) — parallax without a second scroller. Reduce-
 * motion collapses the transl(parallax) to a pure fade.
 */
import { Platform, StyleSheet, View } from "react-native";
import { Article, H2, P } from "@expo/html-elements";
import Animated, {
  interpolate,
  useAnimatedStyle,
} from "react-native-reanimated";
import { useLandingScroll, useSectionProgress } from "../hooks/useScrollProgress";
import { LANDING_COLORS } from "../theme";

interface PillarData {
  eyebrow: string;
  title: string;
  body: string;
  accent: string;
}

const PILLARS: PillarData[] = [
  {
    eyebrow: "01 — Threads",
    title: "The conversation starts here.",
    body: "Group chats, voice notes, and threads that move at the speed of the scene. No algorithm deciding who you hear from.",
    accent: LANDING_COLORS.cyan,
  },
  {
    eyebrow: "02 — Events",
    title: "Your calendar just got dangerous.",
    body: "Drops, afters, listening sessions. RSVP, get the address, and show up where it actually matters.",
    accent: LANDING_COLORS.magenta,
  },
  {
    eyebrow: "03 — Rooms",
    title: "Face-to-face. With no audience.",
    body: "Private video rooms for the people you actually trust. Discreet by default, intimate on purpose.",
    accent: LANDING_COLORS.purple,
  },
  {
    eyebrow: "04 — Access",
    title: "Access looks good on you.",
    body: "Velvet-rope by design. If you know, you know — and now you have the door.",
    accent: LANDING_COLORS.violet,
  },
];

function glowBg(accent: string) {
  if (Platform.OS === "web") {
    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      backgroundImage: `radial-gradient(closest-side, ${accent}44 0%, ${accent}10 55%, rgba(2,3,10,0) 75%)` as any,
    };
  }
  return { backgroundColor: accent, opacity: 0.16 };
}

function Pillar({ data, index }: { data: PillarData; index: number }) {
  const { reduceMotion } = useLandingScroll();
  const { onLayout, progress, enter } = useSectionProgress();
  const alignLeft = index % 2 === 0;

  // Explicit dependency arrays (no Reanimated Babel plugin in the web-vite build).
  const glowStyle = useAnimatedStyle(() => {
    const rm = reduceMotion.value;
    return {
      opacity: interpolate(progress.value, [0, 0.5, 1], [0.15, 0.85, 0.15]),
      transform: rm
        ? []
        : [{ translateY: interpolate(progress.value, [0, 1], [90, -90]) }],
    };
  }, [progress, reduceMotion]);

  const headlineStyle = useAnimatedStyle(() => {
    const rm = reduceMotion.value;
    return {
      opacity: enter.value,
      transform: rm
        ? []
        : [{ translateY: interpolate(progress.value, [0, 1], [44, -44]) }],
    };
  }, [enter, progress, reduceMotion]);

  const eyebrowStyle = useAnimatedStyle(() => {
    const rm = reduceMotion.value;
    return {
      opacity: enter.value,
      transform: rm
        ? []
        : [{ translateY: interpolate(progress.value, [0, 1], [22, -22]) }],
    };
  }, [enter, progress, reduceMotion]);

  return (
    <Article
      nativeID={index === 0 ? "explore" : undefined}
      onLayout={onLayout}
      style={[styles.section, alignLeft ? styles.alignStart : styles.alignEnd]}
    >
      <Animated.View
        pointerEvents="none"
        style={[styles.glow, glowBg(data.accent), glowStyle]}
      />
      <View style={[styles.content, alignLeft ? styles.left : styles.right]}>
        <Animated.Text
          style={[styles.eyebrow, { color: data.accent }, eyebrowStyle]}
        >
          {data.eyebrow}
        </Animated.Text>
        <Animated.View style={headlineStyle}>
          <H2 style={styles.title}>{data.title}</H2>
          <P style={styles.body}>{data.body}</P>
        </Animated.View>
      </View>
    </Article>
  );
}

export function Pillars() {
  return (
    <>
      {PILLARS.map((p, i) => (
        <Pillar key={p.title} data={p} index={i} />
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  section: {
    minHeight: 620,
    justifyContent: "center",
    paddingHorizontal: 28,
    paddingVertical: 80,
    overflow: "hidden",
    backgroundColor: "transparent",
  },
  alignStart: { alignItems: "flex-start" },
  alignEnd: { alignItems: "flex-end" },
  glow: {
    position: "absolute",
    width: 720,
    height: 720,
    borderRadius: 360,
    alignSelf: "center",
  },
  content: { width: "100%", maxWidth: 1100, alignSelf: "center" },
  left: { alignItems: "flex-start" },
  right: { alignItems: "flex-end" },
  eyebrow: {
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 2,
    textTransform: "uppercase",
    marginBottom: 14,
  },
  title: {
    color: LANDING_COLORS.text,
    fontSize: 44,
    lineHeight: 50,
    fontWeight: "800",
    letterSpacing: -1,
    maxWidth: 620,
    margin: 0,
  },
  body: {
    color: LANDING_COLORS.textMuted,
    fontSize: 18,
    lineHeight: 27,
    marginTop: 16,
    maxWidth: 520,
  },
});
