/**
 * Web app header (shared) — logged-in chrome: DVNT logo + search + inbox, same
 * glass style as the marketing header. Semantic universal UI via
 * @expo/html-elements (real <header> on web) + RN primitives; Solito navigation.
 */
import { Pressable, View, StyleSheet, useWindowDimensions } from "react-native";
import { Header } from "@expo/html-elements";
import { useRouter } from "solito/navigation";
import { Search, MessageCircle } from "lucide-react";
import Logo from "./logo";

/** Fixed height logged-in content should clear (header + top offset). */
export const WEB_APP_HEADER_HEIGHT = 78;

export function WebAppHeader() {
  const router = useRouter();
  // Phones: flush, edge-to-edge glass at the top (no floating gap / black frame).
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  return (
    <Header style={[styles.wrap, isMobile && styles.wrapMobile]}>
      <View style={[styles.bar, isMobile && styles.barMobile]}>
        <Pressable onPress={() => router.push("/feed")} style={styles.brand}>
          <Logo width={88} height={34} style={{marginBottom: 4}} />
        </Pressable>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Search"
            onPress={() => router.push("/feed/search")}
            style={styles.iconBtn}
          >
            <Search size={22} color="#FAFAF9" strokeWidth={2} />
          </Pressable>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Inbox"
            onPress={() => router.push("/feed/messages")}
            style={styles.iconBtn}
          >
            <MessageCircle size={22} color="#FAFAF9" strokeWidth={2} />
          </Pressable>
        </View>
      </View>
    </Header>
  );
}

// Web-only style props (position:fixed, backdrop-filter) cast through `any` —
// react-native-web forwards them; RN types don't include them.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const web = (s: Record<string, unknown>) => s as any;

const styles = StyleSheet.create({
  wrap: web({
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    alignItems: "center",
    paddingHorizontal: 16,
    paddingTop: 14,
    pointerEvents: "none",
  }),
  bar: web({
    pointerEvents: "auto",
    width: "100%",
    maxWidth: 1536,
    height: 56,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingLeft: 18,
    paddingRight: 14,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.18)",
    // Liquid glass — light scrim + bright saturated backdrop + lit rim (matches
    // the marketing GlassSurface) so content refracts through instead of frost.
    backgroundColor: "rgba(8,12,20,0.44)",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.30), inset 0 -1px 0 rgba(255,255,255,0.06), 0 10px 30px rgba(0,0,0,0.35)",
    backdropFilter: "saturate(185%) brightness(1.08) blur(16px)",
    WebkitBackdropFilter: "saturate(185%) brightness(1.08) blur(16px)",
  }),
  // Mobile: flush full-width glass at the top, rounded bottom, safe-area aware.
  wrapMobile: web({
    paddingTop: 0,
    paddingHorizontal: 0,
  }),
  barMobile: web({
    marginTop: 2,
    maxWidth: "100%",
    borderRadius: 12,
    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
    height: "auto",
    paddingBottom: 8,
    paddingTop: "calc(8px + env(safe-area-inset-top))",
  }),
  brand: { flexDirection: "row", alignItems: "center" },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  // Search + inbox: liquid-glass chips matching the header surface.
  iconBtn: web({
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.22)",
    backgroundColor: "rgba(255,255,255,0.10)",
    backdropFilter: "saturate(185%) brightness(1.12) blur(10px)",
    WebkitBackdropFilter: "saturate(185%) brightness(1.12) blur(10px)",
    boxShadow:
      "inset 0 1px 0 rgba(255,255,255,0.35), inset 0 -1px 0 rgba(255,255,255,0.06)",
  }),
});
