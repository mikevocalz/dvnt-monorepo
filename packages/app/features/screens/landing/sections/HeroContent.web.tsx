/**
 * Hero copy — WEB. Static, resting fully visible.
 *
 * The web hero has NOT animated since the mobile-Safari fix (REST_VISIBLE=1 in
 * HeroContent.tsx made the mount timeline a 1→1 no-op) — but that no-op still
 * ran Reanimated worklets per frame for ~1.3s after every mount, and any
 * unmount inside that window (CTA tap → /auth, authed redirect, IG-webview
 * lifecycle) left the mapper firing against a detached view descriptor: the
 * DVNT-WEB-6 per-frame crash flood. This fork keeps the exact shipped visual
 * (visible at rest) with zero Reanimated. Native keeps its worklet entrance in
 * HeroContent.tsx.
 */
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useRouter } from "solito/navigation";
import { H1, P } from "@expo/html-elements";
import { LANDING_COLORS, LANDING_GRADIENTS } from "../theme";

const WORDS = ["connect.", "gather.", "move."];

export function HeroContent() {
  const router = useRouter();

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <H1 style={styles.h1}>
        {WORDS.map((w, i) => (
          <Text key={w} style={styles.word}>
            {w}
            {i < WORDS.length - 1 ? " " : ""}
          </Text>
        ))}
      </H1>

      <View>
        <P style={styles.sub}>
          An intentional space for queer people to connect, gather, and move
          culture on their own terms. If you know, you know.
        </P>

        <View style={styles.cta}>
          <Pressable
            accessibilityRole="link"
            onPress={() => router.push("/auth/login")}
            style={styles.primary}
          >
            <Text style={styles.primaryText}>Sign-Up / Sign-In</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const GRADIENT_STYLE = { backgroundImage: LANDING_GRADIENTS.deviantCss } as any;

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    paddingHorizontal: 24,
    maxWidth: 920,
    alignSelf: "center",
  },
  h1: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    textAlign: "center",
    margin: 0,
  },
  word: {
    color: LANDING_COLORS.text,
    fontSize: 60,
    lineHeight: 66,
    fontWeight: "800",
    letterSpacing: -1.5,
  },
  sub: {
    color: LANDING_COLORS.textSecondary,
    fontSize: 19,
    lineHeight: 28,
    textAlign: "center",
    marginTop: 20,
    maxWidth: 620,
    alignSelf: "center",
  },
  cta: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 14,
    justifyContent: "center",
    marginTop: 30,
  },
  primary: {
    paddingHorizontal: 26,
    paddingVertical: 14,
    borderRadius: 12,
    ...GRADIENT_STYLE,
  },
  primaryText: { color: "#0A0118", fontWeight: "800", fontSize: 16 },
});
