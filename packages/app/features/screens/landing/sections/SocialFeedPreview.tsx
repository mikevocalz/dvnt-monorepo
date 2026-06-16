/**
 * Social Feed preview — NATIVE / base. Static kicker/headline/sub + a simple
 * phone mock holding a couple of feed cards. The web split
 * (SocialFeedPreview.web.tsx) adds the GSAP scrubbed in-phone feed scroll.
 */
import { StyleSheet, View } from "react-native";
import { Section, H2, P } from "@expo/html-elements";
import Animated from "react-native-reanimated";
import { LANDING_COLORS } from "../theme";

const STORIES = [
  LANDING_COLORS.cyan,
  LANDING_COLORS.magenta,
  LANDING_COLORS.purple,
  LANDING_COLORS.violet,
];

export function SocialFeedPreview() {
  return (
    <Section style={styles.section}>
      <Animated.Text style={styles.kicker}>Stories &amp; Feed</Animated.Text>
      <H2 style={styles.h2}>The night doesn&apos;t end at the door.</H2>
      <P style={styles.sub}>
        Post photos. Share stories. Start conversations. Keep the scene alive.
      </P>

      <View style={styles.phone}>
        <View style={styles.notch} />
        <View style={styles.screen}>
          {/* Stories row */}
          <View style={styles.storiesRow}>
            {STORIES.map((c, i) => (
              <View key={i} style={[styles.story, { borderColor: c }]} />
            ))}
          </View>

          {/* Post card */}
          <View style={styles.card}>
            <View style={styles.cardHead}>
              <View style={[styles.avatar, { backgroundColor: LANDING_COLORS.purple }]} />
              <Animated.Text style={styles.cardName}>nyla.exe</Animated.Text>
            </View>
            <View style={[styles.cardImage, { backgroundColor: LANDING_COLORS.magenta }]} />
          </View>

          {/* Event recap card */}
          <View style={styles.card}>
            <Animated.Text style={styles.recapTag}>Event recap</Animated.Text>
            <View style={styles.recapStrip}>
              <View style={[styles.recapTile, { backgroundColor: LANDING_COLORS.purple }]} />
              <View style={[styles.recapTile, { backgroundColor: LANDING_COLORS.cyan }]} />
              <View style={[styles.recapTile, { backgroundColor: LANDING_COLORS.magenta }]} />
            </View>
          </View>
        </View>
        <View style={styles.homebar} />
      </View>
    </Section>
  );
}

const styles = StyleSheet.create({
  section: {
    paddingVertical: 80,
    paddingHorizontal: 22,
    backgroundColor: "transparent",
    alignItems: "center",
  },
  kicker: {
    color: LANDING_COLORS.cyan,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 3,
    textTransform: "uppercase",
    marginBottom: 14,
  },
  h2: {
    color: LANDING_COLORS.text,
    fontSize: 28,
    lineHeight: 34,
    fontWeight: "800",
    letterSpacing: -1,
    textAlign: "center",
    maxWidth: 560,
    margin: 0,
  },
  sub: {
    color: LANDING_COLORS.textMuted,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
    marginTop: 14,
    maxWidth: 460,
  },
  phone: {
    width: 280,
    height: 560,
    borderRadius: 46,
    backgroundColor: "#0A0A12",
    borderWidth: 1,
    borderColor: LANDING_COLORS.glassBorderStrong,
    padding: 12,
    marginTop: 40,
    overflow: "hidden",
  },
  notch: {
    position: "absolute",
    top: 14,
    alignSelf: "center",
    width: 120,
    height: 26,
    borderRadius: 16,
    backgroundColor: LANDING_COLORS.bg,
    zIndex: 6,
  },
  homebar: {
    position: "absolute",
    bottom: 12,
    alignSelf: "center",
    width: 110,
    height: 5,
    borderRadius: 3,
    backgroundColor: "rgba(255,255,255,0.4)",
    zIndex: 6,
  },
  screen: {
    flex: 1,
    borderRadius: 36,
    backgroundColor: LANDING_COLORS.bg,
    borderWidth: 1,
    borderColor: LANDING_COLORS.glassBorder,
    paddingTop: 44,
    paddingHorizontal: 14,
    gap: 16,
  },
  storiesRow: { flexDirection: "row", gap: 12 },
  story: {
    width: 50,
    height: 50,
    borderRadius: 25,
    borderWidth: 2,
  },
  card: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: LANDING_COLORS.glassBorder,
    backgroundColor: "rgba(8,10,20,0.7)",
    padding: 12,
    gap: 10,
  },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10 },
  avatar: { width: 34, height: 34, borderRadius: 17 },
  cardName: { color: LANDING_COLORS.text, fontSize: 13, fontWeight: "700" },
  cardImage: { width: "100%", height: 130, borderRadius: 14 },
  recapTag: {
    color: LANDING_COLORS.cyan,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontWeight: "700",
  },
  recapStrip: { flexDirection: "row", gap: 8 },
  recapTile: { flex: 1, height: 60, borderRadius: 12 },
});
