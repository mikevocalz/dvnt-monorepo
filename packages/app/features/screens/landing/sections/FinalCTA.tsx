/**
 * Final pre-footer CTA — NATIVE / base. Static closing lockup; the web split
 * (FinalCTA.web.tsx) adds the GSAP card-settle animation.
 */
import { Platform, Pressable, StyleSheet, View } from "react-native";
import { Section, H2 } from "@expo/html-elements";
import Animated from "react-native-reanimated";
import { LANDING_COLORS, LANDING_GRADIENTS } from "../theme";

const GRADIENT_STYLE =
  Platform.OS === "web"
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ backgroundImage: LANDING_GRADIENTS.deviantCss } as any)
    : { backgroundColor: LANDING_COLORS.purple };

export function FinalCTA() {
  return (
    <Section style={styles.section}>
      <H2 style={styles.head}>
        Find your scene. Bring your people. Experience life together.
      </H2>
      <View style={styles.ctaRow}>
        <Pressable style={[styles.primary, GRADIENT_STYLE]}>
          <Animated.Text style={styles.primaryText}>Download DVNT</Animated.Text>
        </Pressable>
        <Pressable style={styles.ghost}>
          <Animated.Text style={styles.ghostText}>Join the next event</Animated.Text>
        </Pressable>
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  section: { paddingVertical: 110, paddingHorizontal: 24, alignItems: "center", backgroundColor: "transparent" },
  head: {
    color: LANDING_COLORS.text,
    fontSize: 36,
    lineHeight: 42,
    fontWeight: "800",
    letterSpacing: -1.5,
    textAlign: "center",
    maxWidth: 620,
    margin: 0,
  },
  ctaRow: { flexDirection: "row", flexWrap: "wrap", gap: 14, justifyContent: "center", marginTop: 30 },
  primary: { paddingHorizontal: 30, paddingVertical: 15, borderRadius: 14 },
  primaryText: { color: "#0A0118", fontWeight: "800", fontSize: 16 },
  ghost: { paddingHorizontal: 30, paddingVertical: 15, borderRadius: 14, borderWidth: 1, borderColor: LANDING_COLORS.glassBorderStrong },
  ghostText: { color: LANDING_COLORS.text, fontWeight: "700", fontSize: 16 },
});
