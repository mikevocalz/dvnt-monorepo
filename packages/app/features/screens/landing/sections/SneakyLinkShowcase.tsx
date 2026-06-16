/**
 * Sneaky Link showcase — NATIVE / base. Static tiers + host abilities; the web
 * split (SneakyLinkShowcase.web.tsx) adds the GSAP video-room timeline.
 */
import { StyleSheet, View } from "react-native";
import { Section, H2, P } from "@expo/html-elements";
import Animated from "react-native-reanimated";
import { LANDING_COLORS } from "../theme";

const TIERS = [
  { name: "Free", lines: ["5-minute sessions", "Up to 5 people per link"] },
  { name: "Core", lines: ["Unlimited sessions", "Up to 10 people per link"] },
  { name: "Pro", lines: ["Unlimited sessions", "Up to 50 people per link"] },
];

export function SneakyLinkShowcase() {
  return (
    <Section style={styles.section}>
      <Animated.Text style={styles.kicker}>Sneaky Link</Animated.Text>
      <H2 style={styles.h2}>
        Anonymous video calling for the people you actually want in the room.
      </H2>
      <View style={styles.tiers}>
        {TIERS.map((t) => (
          <View key={t.name} style={styles.tier}>
            <Animated.Text style={styles.tierName}>{t.name}</Animated.Text>
            {t.lines.map((l) => (
              <Animated.Text key={l} style={styles.tierLine}>{l}</Animated.Text>
            ))}
          </View>
        ))}
      </View>
      <P style={styles.note}>
        Host controls: block accounts, require face for access, mute chat, and
        control the room before anyone enters.
      </P>
    </Section>
  );
}

const styles = StyleSheet.create({
  section: { paddingVertical: 80, paddingHorizontal: 22, backgroundColor: "transparent", alignItems: "center" },
  kicker: { color: LANDING_COLORS.magenta, fontSize: 13, fontWeight: "700", letterSpacing: 3, textTransform: "uppercase", marginBottom: 14 },
  h2: { color: LANDING_COLORS.text, fontSize: 28, lineHeight: 34, fontWeight: "800", letterSpacing: -1, textAlign: "center", maxWidth: 560, margin: 0 },
  tiers: { gap: 14, marginTop: 28, width: "100%", maxWidth: 420 },
  tier: { borderRadius: 18, borderWidth: 1, borderColor: LANDING_COLORS.glassBorder, backgroundColor: "rgba(18,20,30,0.7)", padding: 18 },
  tierName: { color: LANDING_COLORS.cyan, fontWeight: "800", fontSize: 14, letterSpacing: 2, textTransform: "uppercase", marginBottom: 6 },
  tierLine: { color: LANDING_COLORS.textMuted, fontSize: 14, lineHeight: 21 },
  note: { color: LANDING_COLORS.textMuted, fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 22, maxWidth: 460 },
});
