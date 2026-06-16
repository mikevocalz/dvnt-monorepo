/**
 * Mobile nav drawer — NATIVE / base. Minimal RN modal version of the web glass
 * drawer (HeaderDrawer.web.tsx). The marketing landing is web-first; native
 * keeps a simple slide-over so the split resolves and the API matches.
 */
import { Modal, Pressable, StyleSheet, View } from "react-native";
import { A } from "@expo/html-elements";
import Animated from "react-native-reanimated";
import { LANDING_COLORS, LANDING_GRADIENTS } from "../theme";

interface NavItem {
  label: string;
  href: string;
}

export function HeaderDrawer({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: NavItem[];
  pathname: string;
}) {
  return (
    <Modal visible={open} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.scrim} onPress={onClose} />
      <View style={styles.panel}>
        <Animated.Text style={styles.wordmark}>DVNT</Animated.Text>
        {items.map((item) => (
          <A key={item.label} href={item.href} onPress={onClose as never} style={styles.link}>
            <Animated.Text style={styles.linkText}>{item.label}</Animated.Text>
          </A>
        ))}
        <A href="/auth/login" onPress={onClose as never} style={styles.login}>
          <Animated.Text style={styles.loginText}>Login</Animated.Text>
        </A>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { ...StyleSheet.absoluteFill, backgroundColor: "rgba(2,3,10,0.6)" },
  panel: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: "82%",
    maxWidth: 360,
    padding: 26,
    gap: 8,
    backgroundColor: LANDING_COLORS.bgElevated,
    borderLeftWidth: 1,
    borderLeftColor: LANDING_COLORS.glassBorderStrong,
  },
  wordmark: {
    color: LANDING_COLORS.text,
    fontFamily: "Republica-Minor",
    fontWeight: "900",
    fontSize: 24,
    letterSpacing: 2,
    marginBottom: 24,
  },
  link: { paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: LANDING_COLORS.glassBorder },
  linkText: { color: LANDING_COLORS.text, fontSize: 26, fontWeight: "800" },
  login: {
    marginTop: 22,
    paddingVertical: 14,
    borderRadius: 13,
    alignItems: "center",
    backgroundColor: LANDING_COLORS.purple,
  },
  loginText: { color: "#fff", fontWeight: "900", fontSize: 17, letterSpacing: 1 },
});

// Keep web's flowing-gradient reference type-compatible.
export const DRAWER_GRADIENT = LANDING_GRADIENTS.deviantCss;
