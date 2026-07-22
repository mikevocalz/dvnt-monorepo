/**
 * Four pillar sections. Each layers a glow + index + headline + body that
 * translate at distinct rates off the section's own progress (derived from the
 * single shared scrollOffset) — parallax without a second scroller. Reduce-
 * motion collapses the transl(parallax) to a pure fade.
 */
import { Image, Platform, StyleSheet, View } from "react-native";
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
  /** Pair of promo shots (public/landing) shown beside the copy. */
  images?: { src: string; alt: string }[];
}

const PILLARS: PillarData[] = [
  {
    eyebrow: "01 — Threads",
    title: "Community online. Community IRL.",
    body: "Group chats, voice notes, and threads that move at the speed of the scene. Set up your profile and post today — no algorithm deciding who you hear from.",
    accent: LANDING_COLORS.cyan,
    images: [
      { src: "/landing/p4.jpg", alt: "DVNT app showing a profile with threads and community posts" },
      { src: "/landing/p2.jpg", alt: "Set up your profile. Post today." },
    ],
  },
  {
    eyebrow: "02 — Events",
    title: "Your calendar just got dangerous.",
    body: "Drops, afters, listening sessions. RSVP, get the address, and show up where it actually matters. Discover and promote events — one community, online & IRL.",
    accent: LANDING_COLORS.magenta,
    images: [
      { src: "/landing/p5.jpg", alt: "DVNT events feed with parties and listening sessions" },
      { src: "/landing/p1.jpg", alt: "The DVNT app — build your profile, connect beyond the party" },
    ],
  },
  {
    eyebrow: "03 — Rooms",
    title: "Face-to-face. With no audience.",
    body: "Private “Sneaky Link” video rooms for the people you actually trust. ID & selfie verified — no bots, no fake profiles. Discreet by default, intimate on purpose.",
    accent: LANDING_COLORS.purple,
    images: [
      { src: "/landing/p6.jpg", alt: "Sneaky Link video rooms — face-to-face with no audience" },
      { src: "/landing/p3.jpg", alt: "ID & selfie verification — just real people, real connections" },
    ],
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

  // Shots drift the opposite way to the headline for depth.
  const imagesStyle = useAnimatedStyle(() => {
    const rm = reduceMotion.value;
    return {
      opacity: enter.value,
      transform: rm
        ? []
        : [{ translateY: interpolate(progress.value, [0, 1], [-30, 30]) }],
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
      <View
        style={[
          styles.content,
          data.images && styles.contentRow,
          data.images && !alignLeft && styles.contentRowReverse,
        ]}
      >
        <View style={[styles.copyBlock, alignLeft ? styles.left : styles.right]}>
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
        {data.images && (
          <Animated.View style={[styles.imageRow, imagesStyle]}>
            {data.images.map((img, i) => (
              <Image
                key={img.src}
                source={{ uri: img.src }}
                accessibilityLabel={img.alt}
                resizeMode="cover"
                style={[
                  styles.shot,
                  { borderColor: `${data.accent}33` },
                  i === 1 && styles.shotOffset,
                ]}
              />
            ))}
          </Animated.View>
        )}
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
  // With images: copy + shot pair share the row, wrapping to a stack on
  // narrow screens (each child has a min width, so flexWrap handles mobile).
  contentRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    rowGap: 40,
    columnGap: 32,
  },
  contentRowReverse: { flexDirection: "row-reverse" },
  copyBlock: { flexGrow: 1, flexShrink: 1, flexBasis: 380, minWidth: 280 },
  imageRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 18,
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 480,
  },
  shot: {
    width: 244,
    aspectRatio: 727 / 900,
    borderRadius: 20,
    borderWidth: 1,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  shotOffset: { marginTop: 44 },
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
