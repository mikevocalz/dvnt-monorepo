/**
 * Membership passes — NATIVE / base. Static, accessible rendering of the same
 * copy the web split animates as fan-out passes. (Web uses
 * MembershipPasses.web.tsx with GSAP.) Two pricing cards stacked vertically.
 */
import { StyleSheet, View } from "react-native";
import { Section, H2, P } from "@expo/html-elements";
import Animated from "react-native-reanimated";
import { LANDING_COLORS } from "../theme";

interface Pass {
  key: string;
  tier: string;
  price: string;
  priceNote: string;
  sub?: string;
  bullets: string[];
  cta: string;
  recommended?: boolean;
}

const PASSES: Pass[] = [
  {
    key: "free",
    tier: "FREE",
    price: "$0",
    priceNote: "/month",
    bullets: [
      "Sneaky Link: 5-minute sessions",
      "Up to 5 people per link",
      "RSVP to free events",
      "Purchase tickets at standard pricing",
    ],
    cta: "Get started",
  },
  {
    key: "core",
    tier: "CORE",
    price: "$25",
    priceNote: "/month",
    sub: "Become a member.",
    recommended: true,
    bullets: ["Better access", "App perks", "Event benefits", "Community access"],
    cta: "Become a member",
  },
];

export function MembershipPasses() {
  return (
    <Section style={styles.section}>
      <Animated.Text style={styles.kicker}>DVNT Membership</Animated.Text>
      <Animated.Text style={styles.tagline}>
        REAL PEOPLE. REAL CONNECTIONS.
      </Animated.Text>
      <H2 style={styles.headline}>
        DVNT Membership unlocks the best of our app and events.
      </H2>
      <P style={styles.sub}>Connect digitally. Experience life together.</P>

      <View style={styles.deck}>
        {PASSES.map((p) => (
          <View
            key={p.key}
            style={[styles.pass, p.recommended ? styles.passRec : null]}
          >
            <View style={styles.passHead}>
              <Animated.Text style={styles.tier}>{p.tier}</Animated.Text>
              {p.recommended ? (
                <Animated.Text style={styles.recPill}>Recommended</Animated.Text>
              ) : null}
            </View>

            <View style={styles.priceRow}>
              <Animated.Text style={styles.price}>{p.price}</Animated.Text>
              <Animated.Text style={styles.priceNote}>{p.priceNote}</Animated.Text>
            </View>
            {p.sub ? (
              <Animated.Text style={styles.passSub}>{p.sub}</Animated.Text>
            ) : null}

            <View style={styles.bullets}>
              {p.bullets.map((b) => (
                <View key={b} style={styles.bullet}>
                  <View style={styles.dot} />
                  <Animated.Text style={styles.bulletText}>{b}</Animated.Text>
                </View>
              ))}
            </View>

            <View style={[styles.cta, p.recommended ? styles.ctaRec : null]}>
              <Animated.Text
                style={[styles.ctaText, p.recommended ? styles.ctaTextRec : null]}
              >
                {p.cta}
              </Animated.Text>
            </View>
          </View>
        ))}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: 96,
    paddingHorizontal: 24,
    alignItems: "center",
    backgroundColor: "transparent",
  },
  kicker: {
    color: LANDING_COLORS.cyan,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 3,
    textTransform: "uppercase",
    marginBottom: 14,
  },
  tagline: {
    color: LANDING_COLORS.magenta,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 3,
    textTransform: "uppercase",
    marginBottom: 18,
  },
  headline: {
    color: LANDING_COLORS.text,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "800",
    letterSpacing: -1.2,
    textAlign: "center",
    margin: 0,
    maxWidth: 560,
  },
  sub: {
    color: LANDING_COLORS.textMuted,
    fontSize: 18,
    lineHeight: 27,
    textAlign: "center",
    marginTop: 18,
    maxWidth: 480,
  },
  deck: {
    width: "100%",
    maxWidth: 420,
    marginTop: 44,
    gap: 22,
  },
  pass: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: LANDING_COLORS.glassBorder,
    backgroundColor: LANDING_COLORS.bgElevated,
    padding: 26,
  },
  passRec: {
    borderColor: LANDING_COLORS.cyan,
    borderWidth: 2,
  },
  passHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  tier: {
    color: LANDING_COLORS.textMuted,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  recPill: {
    color: LANDING_COLORS.bg,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    backgroundColor: LANDING_COLORS.cyan,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    overflow: "hidden",
  },
  priceRow: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: 4,
  },
  price: {
    color: LANDING_COLORS.text,
    fontSize: 44,
    fontWeight: "800",
    letterSpacing: -1.5,
    lineHeight: 46,
  },
  priceNote: {
    color: LANDING_COLORS.textMuted,
    fontSize: 15,
    fontWeight: "600",
    marginBottom: 6,
  },
  passSub: {
    color: LANDING_COLORS.textMuted,
    fontSize: 15,
    marginTop: 12,
  },
  bullets: {
    marginTop: 24,
    gap: 13,
  },
  bullet: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: 11,
  },
  dot: {
    marginTop: 7,
    width: 6,
    height: 6,
    borderRadius: 999,
    backgroundColor: LANDING_COLORS.cyan,
  },
  bulletText: {
    flex: 1,
    color: LANDING_COLORS.text,
    fontSize: 15,
    lineHeight: 21,
  },
  cta: {
    marginTop: 28,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: LANDING_COLORS.glassBorderStrong,
    paddingVertical: 13,
    paddingHorizontal: 18,
    alignItems: "center",
  },
  ctaRec: {
    borderWidth: 0,
    backgroundColor: LANDING_COLORS.cyan,
  },
  ctaText: {
    color: LANDING_COLORS.text,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
  },
  ctaTextRec: {
    color: LANDING_COLORS.bg,
  },
});
