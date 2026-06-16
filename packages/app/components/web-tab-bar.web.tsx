/**
 * Web tab bar (shared). Native uses NativeTabs; web renders this. Liquid-glass
 * bar — Home · Events · [+] · Activity · Profile — using the shared CenterButton
 * and Solito navigation. Semantic universal UI via @expo/html-elements (real
 * <nav>) + RN primitives (works on Next; native never imports this .web file).
 */
import { Pressable, Text, View, StyleSheet, useWindowDimensions } from "react-native";
import { Nav } from "@expo/html-elements";
import { useRouter, usePathname } from "solito/navigation";
import { Home, Calendar, Plus, Heart, User } from "lucide-react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { CenterButton } from "./center-button.web";

const CYAN = "#3FDCFF";
const MUTED = "rgba(255,255,255,0.55)";

type Tab = { href: string; Icon: typeof Home; label: string };
const LEFT: Tab[] = [
  { href: "/feed", Icon: Home, label: "Home" },
  { href: "/events", Icon: Calendar, label: "Events" },
];

export function WebTabBar() {
  const router = useRouter();
  const pathname = usePathname();
  // Top-level resource routes: /feed · /events · /notifications · /profile/{me}.
  const username = useAuthStore((s) => s.user?.username);
  const RIGHT: Tab[] = [
    { href: "/notifications", Icon: Heart, label: "Activity" },
    {
      href: username ? `/profile/${username}` : "/profile",
      Icon: User,
      label: "Profile",
    },
  ];
  // On phones the bar sits flush at the absolute bottom (edge-to-edge, safe-area
  // aware); on larger screens it floats as a centered liquid-glass pill.
  const { width } = useWindowDimensions();
  const isMobile = width < 768;

  const TabItem = ({ href, Icon, label }: Tab) => {
    const active = pathname === href;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: active }}
        onPress={() => router.push(href)}
        style={styles.item}
      >
        <Icon size={24} strokeWidth={active ? 2.4 : 2} color={active ? CYAN : MUTED} />
        <Text
          style={{ fontSize: 11, fontWeight: active ? "700" : "500", color: active ? CYAN : MUTED }}
        >
          {label}
        </Text>
      </Pressable>
    );
  };

  return (
    <Nav style={[styles.wrap, isMobile && styles.wrapMobile]} aria-label="Primary">
      <View style={[styles.bar, isMobile && styles.barMobile]}>
        {LEFT.map((t) => (
          <TabItem key={t.href} {...t} />
        ))}
        <CenterButton Icon={Plus} onPress={() => router.push("/feed/create")} />
        {RIGHT.map((t) => (
          <TabItem key={t.href} {...t} />
        ))}
      </View>
    </Nav>
  );
}

// Web-only style props (position:fixed, backdrop-filter) cast through `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const web = (s: Record<string, unknown>) => s as any;

const styles = StyleSheet.create({
  wrap: web({
    position: "fixed",
    left: 0,
    right: 0,
    bottom: 18,
    alignItems: "center",
    zIndex: 1000,
    pointerEvents: "none",
    paddingHorizontal: 16,
  }),
  bar: web({
    pointerEvents: "auto",
    width: "100%",
    maxWidth: 460,
    height: 64,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 4,
    paddingHorizontal: 18,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(8,10,18,0.6)",
    boxShadow: "0 10px 30px rgba(0,0,0,0.35)",
    backdropFilter: "saturate(160%) blur(18px)",
    WebkitBackdropFilter: "saturate(160%) blur(18px)",
  }),
  // Mobile: flush to the absolute bottom, edge-to-edge, safe-area aware.
  wrapMobile: web({
    bottom: 2,
    paddingHorizontal: 0,
  }),
  barMobile: web({
    maxWidth: "100%",
    borderRadius: 20,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    boxShadow: "0 -8px 24px rgba(0,0,0,0.4)",
    backgroundColor: "rgba(8,10,18,0.6)",
    height: "auto",
    paddingTop: 8,
    paddingBottom: "calc(8px + env(safe-area-inset-bottom))",
  }),
  item: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
});
