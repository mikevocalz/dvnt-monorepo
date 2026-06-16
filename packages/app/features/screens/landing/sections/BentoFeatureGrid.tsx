/**
 * Bento feature grid — NATIVE / base. Static, accessible cards with the same
 * copy the web split (BentoFeatureGrid.web.tsx) animates with GSAP.
 */
import { StyleSheet, View } from "react-native";
import { Section, H2, H3, P } from "@expo/html-elements";
import Animated from "react-native-reanimated";
import { LANDING_COLORS } from "../theme";

const CARDS = [
  { title: "Find Your Scene", body: "Discover events that match your vibe, your city, and your people." },
  { title: "Buy Tickets Fast", body: "Apple Pay, Cash App Pay, Klarna, Afterpay, Affirm, or card." },
  { title: "See Who's Going", body: "Know the energy before you commit." },
  { title: "Post the Night", body: "Share photos, stories, and moments while the room is still moving." },
  { title: "Sneaky Link", body: "Anonymous video calling built for quick, private, real-time connection." },
  { title: "Host Tools", body: "Block accounts, require face for access, mute chat, control the link you host." },
  { title: "QR Entry", body: "Show up, scan in, and keep the line moving." },
  { title: "Membership", body: "Unlock the best of the app and events." },
];

export function BentoFeatureGrid() {
  return (
    <Section style={styles.section}>
      <H2 style={styles.h2}>Everything the night needs, in one place.</H2>
      <View style={styles.grid}>
        {CARDS.map((c) => (
          <View key={c.title} style={styles.card}>
            <H3 style={styles.title}>{c.title}</H3>
            <P style={styles.body}>{c.body}</P>
          </View>
        ))}
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  section: { paddingVertical: 80, paddingHorizontal: 20, backgroundColor: "transparent" },
  h2: {
    color: LANDING_COLORS.text,
    fontSize: 32,
    lineHeight: 38,
    fontWeight: "800",
    letterSpacing: -1,
    textAlign: "center",
    marginBottom: 28,
  },
  grid: { gap: 14, maxWidth: 560, alignSelf: "center", width: "100%" },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    borderColor: LANDING_COLORS.glassBorder,
    backgroundColor: "rgba(18,20,30,0.7)",
    padding: 20,
  },
  title: { color: LANDING_COLORS.text, fontSize: 18, fontWeight: "800", margin: 0 },
  body: { color: LANDING_COLORS.textMuted, fontSize: 15, lineHeight: 22, marginTop: 8 },
});
