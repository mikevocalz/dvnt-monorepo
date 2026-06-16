/**
 * Header "Login" button — NATIVE / base variant (also the type source for the
 * .web.tsx split). Keeps the existing gradient pill; the flowing-gradient +
 * pulsing glow treatment lives in HeaderLoginButton.web.tsx (CSS only).
 */
import { Platform, StyleSheet, View } from "react-native";
import { A } from "@expo/html-elements";
import Animated from "react-native-reanimated";
import { LANDING_COLORS, LANDING_GRADIENTS } from "../theme";

const GRADIENT_STYLE =
  Platform.OS === "web"
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ backgroundImage: LANDING_GRADIENTS.deviantCss } as any)
    : { backgroundColor: LANDING_COLORS.purple };

export function HeaderLoginButton({ active }: { active?: boolean }) {
  return (
    <A
      href="/auth/login"
      style={[styles.wrap, active && styles.wrapActive] as never}
    >
      <View style={[styles.btn, active && styles.btnActive]}>
        <Animated.Text style={styles.text}>Login</Animated.Text>
      </View>
    </A>
  );
}

const styles = StyleSheet.create({
  wrap: {},
  wrapActive: { transform: [{ scale: 1.02 }] },
  btn: {
    marginLeft: 20,
    paddingHorizontal: 20,
    paddingVertical: 6,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    ...GRADIENT_STYLE,
  },
  btnActive: {
    borderWidth: 2,
    borderColor: LANDING_COLORS.cyan,
    boxShadow: "0px 0px 12px rgba(63,220,255,0.6)",
  },
  text: {
    color: "#0A0118",
    fontFamily: "Republica-Minor",
    fontWeight: "900",
    fontSize: 16,
    letterSpacing: 0.5,
  },
});
