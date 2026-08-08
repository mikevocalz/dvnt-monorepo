/**
 * Four pillar sections — WEB. Same layered parallax as the native version
 * (glow + index + headline + body translating at distinct rates off the
 * section's scroll progress), but driven by GSAP ScrollTrigger instead of
 * Reanimated worklets: Reanimated's web mappers could keep firing against
 * detached view descriptors after unmount (DVNT-WEB-6), while gsap.context /
 * ScrollTrigger.kill provably removes every listener on cleanup.
 *
 * The math mirrors useSectionProgress exactly:
 *   progress p: scroll [top-vh → top → top+height] ↦ [0 → 0.5 → 1] (clamped)
 *   enter    e: scroll [top-vh → top-0.35vh]       ↦ [0 → 1]       (clamped)
 * Reduced-motion gets the static resolved layout (useGsapScope contract).
 * Native fallback: Pillars.tsx.
 */
import { useRef } from "react";
import { Image, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { Article, H2, P } from "@expo/html-elements";
import { useGsapScope, ScrollTrigger } from "../hooks/useGsap";
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
    // The ID & selfie verification shot (p3) moved up to IdentityStrip —
    // it leads the page as the most complicated signup requirement.
    images: [
      { src: "/landing/p6.jpg", alt: "Sneaky Link video rooms — face-to-face with no audience" },
    ],
  },
];

function glowBg(accent: string): ViewStyle {
  return {
    backgroundImage: `radial-gradient(closest-side, ${accent}44 0%, ${accent}10 55%, rgba(2,3,10,0) 75%)`,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

function Pillar({ data, index }: { data: PillarData; index: number }) {
  const glowRef = useRef<View>(null);
  const eyebrowRef = useRef<Text>(null);
  const headlineRef = useRef<View>(null);
  const imagesRef = useRef<View>(null);
  const alignLeft = index % 2 === 0;

  const ref = useGsapScope((self, gsap) => {
    const glow = glowRef.current as unknown as HTMLElement | null;
    const eyebrow = eyebrowRef.current as unknown as HTMLElement | null;
    const headline = headlineRef.current as unknown as HTMLElement | null;
    const images = imagesRef.current as unknown as HTMLElement | null;
    if (!glow || !eyebrow || !headline) return;

    let top = 0;
    let height = 1;
    const measure = () => {
      const r = self.getBoundingClientRect();
      top = r.top + window.scrollY;
      height = Math.max(1, r.height);
    };

    // quickSetters (created once) instead of per-tick gsap.set tweens — this
    // runs on every scroll frame.
    const setters = (el: HTMLElement) => ({
      y: gsap.quickSetter(el, "y", "px"),
      o: gsap.quickSetter(el, "opacity"),
    });
    const sGlow = setters(glow);
    const sEyebrow = setters(eyebrow);
    const sHeadline = setters(headline);
    const sImages = images ? setters(images) : null;

    const apply = () => {
      const y = window.scrollY;
      const vh = Math.max(1, window.innerHeight);
      // Piecewise progress with its midpoint when the section top hits the
      // viewport top — identical to the old useSectionProgress interpolation.
      const p =
        y <= top
          ? clamp01((0.5 * (y - (top - vh))) / vh)
          : clamp01(0.5 + (0.5 * (y - top)) / height);
      const e = clamp01((y - (top - vh)) / (vh * 0.65));

      sGlow.o(p <= 0.5 ? 0.15 + 1.4 * p : 0.85 - 1.4 * (p - 0.5));
      sGlow.y(90 - 180 * p);
      sEyebrow.o(e);
      sEyebrow.y(22 - 44 * p);
      sHeadline.o(e);
      sHeadline.y(44 - 88 * p);
      // Shots drift the opposite way to the headline for depth.
      if (sImages) {
        sImages.o(e);
        sImages.y(-30 + 60 * p);
      }
    };

    measure();
    apply();
    ScrollTrigger.create({
      trigger: self,
      start: "top bottom",
      end: "bottom top",
      onUpdate: apply,
      // Resize / late image loads move the section — remeasure, reapply.
      onRefresh: () => {
        measure();
        apply();
      },
    });
  });

  return (
    <div ref={ref as React.RefObject<HTMLDivElement>}>
      <Article
        nativeID={index === 0 ? "explore" : undefined}
        style={[styles.section, alignLeft ? styles.alignStart : styles.alignEnd]}
      >
        <View
          ref={glowRef}
          pointerEvents="none"
          style={[styles.glow, glowBg(data.accent)]}
        />
        <View
          style={[
            styles.content,
            data.images && styles.contentRow,
            data.images && !alignLeft && styles.contentRowReverse,
          ]}
        >
          <View style={[styles.copyBlock, alignLeft ? styles.left : styles.right]}>
            <Text
              ref={eyebrowRef}
              style={[styles.eyebrow, { color: data.accent }]}
            >
              {data.eyebrow}
            </Text>
            <View ref={headlineRef}>
              <H2 style={styles.title}>{data.title}</H2>
              <P style={styles.body}>{data.body}</P>
            </View>
          </View>
          {data.images && (
            <View ref={imagesRef} style={styles.imageRow}>
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
            </View>
          )}
        </View>
      </Article>
    </div>
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
    // Static baseline = the worklet's off-screen rest value (p=0). GSAP takes
    // over from here; reduced-motion keeps this resolved static layout.
    opacity: 0.15,
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
