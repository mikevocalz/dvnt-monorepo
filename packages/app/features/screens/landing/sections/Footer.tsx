/**
 * Footer — semantic landmark with store badges, wordmark, and nav. Real
 * anchors (@expo/html-elements A) on web; accessible on native.
 */
import { Platform, StyleSheet, View } from "react-native";
import { A, Footer as FooterTag, Nav } from "@expo/html-elements";
import Animated from "react-native-reanimated";
import Logo from "@dvnt/app/components/logo";
import { LANDING_COLORS } from "../theme";

const LINKS = [
  { label: "Pricing", href: "/pricing" },
  { label: "Privacy", href: "/privacy" },
  { label: "FAQ", href: "/faq" },
  { label: "Login", href: "/auth/login" },
];

function StoreBadge({ store }: { store: "App Store" | "Google Play" }) {
  return (
    <View style={styles.badge}>
      <Animated.Text style={styles.badgeKicker}>
        {store === "App Store" ? "Download on the" : "Get it on"}
      </Animated.Text>
      <Animated.Text style={styles.badgeName}>{store}</Animated.Text>
    </View>
  );
}

export function Footer() {
  return (
    <FooterTag nativeID="download" style={styles.footer}>
      <View style={styles.top}>
        <View style={styles.brandCol}>
          <Logo width={120} height={47} />
          <Animated.Text style={styles.tagline}>
            connect. gather. move.
          </Animated.Text>
        </View>

        <View style={styles.badges}>
          <StoreBadge store="App Store" />
          <StoreBadge store="Google Play" />
        </View>
      </View>

      <View style={styles.divider} />

      <View style={styles.bottom}>
        <Animated.Text style={styles.copy}>
          © 2026 DVNT. Move culture on your own terms.
        </Animated.Text>
        <Nav style={styles.nav}>
          {LINKS.map((l) => (
            <A key={l.label} href={l.href} style={styles.link}>
              <Animated.Text style={styles.linkText}>{l.label}</Animated.Text>
            </A>
          ))}
        </Nav>
      </View>
    </FooterTag>
  );
}

const styles = StyleSheet.create({
  footer: {
    backgroundColor: LANDING_COLORS.bgElevated,
    paddingHorizontal: 28,
    paddingVertical: 56,
    borderTopWidth: 1,
    borderTopColor: LANDING_COLORS.glassBorder,
  },
  top: {
    width: "100%",
    maxWidth: 1536,
    alignSelf: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 28,
    justifyContent: "space-between",
    alignItems: "center",
  },
  brandCol: { gap: 12 },
  tagline: {
    color: LANDING_COLORS.textSecondary,
    fontSize: 16,
    fontWeight: "600",
  },
  badges: { flexDirection: "row", gap: 14, flexWrap: "wrap" },
  badge: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: LANDING_COLORS.glassBorderStrong,
    backgroundColor: "rgba(255,255,255,0.04)",
    minWidth: 150,
  },
  badgeKicker: { color: LANDING_COLORS.textMuted, fontSize: 11 },
  badgeName: { color: LANDING_COLORS.text, fontSize: 18, fontWeight: "800" },
  divider: {
    height: 1,
    backgroundColor: LANDING_COLORS.glassBorder,
    marginVertical: 28,
    width: "100%",
    maxWidth: 1536,
    alignSelf: "center",
  },
  bottom: {
    width: "100%",
    maxWidth: 1536,
    alignSelf: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 16,
    justifyContent: "space-between",
    alignItems: "center",
  },
  copy: { color: LANDING_COLORS.textMuted, fontSize: 14 },
  nav: { flexDirection: "row", gap: 22, flexWrap: "wrap" },
  link: { paddingVertical: 4 },
  linkText: {
    color: LANDING_COLORS.textSecondary,
    fontSize: 14,
    fontWeight: "600",
  },
});
