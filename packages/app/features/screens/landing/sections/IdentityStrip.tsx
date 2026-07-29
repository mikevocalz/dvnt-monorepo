/**
 * Identity strip — NATIVE / base. Static, accessible rendering of the same copy
 * the web split animates. (Web uses IdentityStrip.web.tsx with GSAP.)
 */
import { Image, StyleSheet, View } from "react-native";
import { Section, H2, P } from "@expo/html-elements";
import Animated from "react-native-reanimated";
import { LANDING_COLORS } from "../theme";

const BADGES = [
  "Stories",
  "Video Chat",
  "Tickets",
  "Sneaky Link",
  "Events",
  "Posts",
  "Apple Pay",
  "QR Entry",
];

export function IdentityStrip() {
  return (
    <Section style={styles.section}>
      <Animated.Text style={styles.eyebrow}>
        Real people. Real connections.
      </Animated.Text>
      <H2 style={styles.head}>Your scene. Your people. Your night.</H2>
      <P style={styles.sub}>
        Events, stories, posts, tickets, and live video — all in one social app.
      </P>
      <View style={styles.badges}>
        {BADGES.map((b) => (
          <Animated.Text key={b} style={styles.badge}>
            {b}
          </Animated.Text>
        ))}
      </View>
      {/* Verification explainer leads the promo imagery — it's the most
          complicated signup requirement, so it comes before the pillars. */}
      <Image
        source={{ uri: "/landing/p3.jpg" }}
        accessibilityLabel="ID & selfie verification — no bots, no fake profiles. Just real people, real community, real connections."
        resizeMode="cover"
        style={styles.verifyShot}
      />
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
  eyebrow: {
    color: LANDING_COLORS.magenta,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 3,
    textTransform: "uppercase",
    marginBottom: 18,
  },
  head: {
    color: LANDING_COLORS.text,
    fontSize: 40,
    lineHeight: 44,
    fontWeight: "800",
    letterSpacing: -1.5,
    textAlign: "center",
    margin: 0,
    maxWidth: 620,
  },
  sub: {
    color: LANDING_COLORS.textMuted,
    fontSize: 18,
    lineHeight: 27,
    textAlign: "center",
    marginTop: 20,
    maxWidth: 520,
  },
  badges: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    gap: 10,
    marginTop: 30,
    maxWidth: 560,
  },
  verifyShot: {
    width: 380,
    maxWidth: "88%",
    aspectRatio: 727 / 900,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: "rgba(138,64,207,0.33)",
    marginTop: 44,
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  badge: {
    color: LANDING_COLORS.textSecondary,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.5,
    textTransform: "uppercase",
    borderWidth: 1,
    borderColor: LANDING_COLORS.glassBorder,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 7,
    overflow: "hidden",
  },
});
