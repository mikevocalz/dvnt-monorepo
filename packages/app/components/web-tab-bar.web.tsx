"use client";

/**
 * Web tab bar (shared). Native uses NativeTabs; web renders this. Liquid-glass
 * bar — Home · Events · [+] · Activity · Profile — using the shared CenterButton
 * and Solito navigation. The viewport layer uses a real <nav> portalled to
 * body; native never imports this .web file.
 */
import { useEffect, useState, useRef, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { Pressable, Text, View, StyleSheet, useWindowDimensions } from "react-native";
import { useRouter, usePathname } from "solito/navigation";
import { Home, Calendar, Plus, Heart, User } from "lucide-react";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";
import { useVisualViewportBottom } from "./use-visual-viewport-bottom.web";
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
  // On phones the bar sits flush at the viewport bottom (edge-to-edge, safe-area
  // aware); on larger screens it floats as a centered liquid-glass pill.
  const { width } = useWindowDimensions();
  const isMobile = width < 768;
  // Keep SSR and the first client render identical. Portalling only after mount
  // also avoids reading document on the server. The portal keeps fixed chrome
  // outside scrolling, transformed or paint-contained app/layout ancestors.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  const viewportRef = useRef<HTMLElement>(null);
  // Limit the Safari editor workaround to routes covered by editor tests.
  // Chat/comment composers retain their existing shared bottom:0 behavior.
  const isEventEditor = pathname === "/feed/events/create" ||
    /^\/feed\/edit-event\/[^/]+\/?$/.test(pathname ?? "");
  useVisualViewportBottom(viewportRef, mounted && isMobile && isEventEditor);

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

  if (!mounted) return null;

  return createPortal(
    <nav
      ref={viewportRef}
      data-dvnt-tab-bar=""
      style={{ ...viewportStyle, ...(isMobile ? mobileViewportStyle : {}), ...(isMobile && isEventEditor ? editorViewportStyle : {}) }}
      aria-label="Primary"
    >
      <View style={[styles.bar, isMobile && styles.barMobile]}>
        {LEFT.map((t) => (
          <TabItem key={t.href} {...t} />
        ))}
        <CenterButton Icon={Plus} onPress={() => router.push("/feed/create")} />
        {RIGHT.map((t) => (
          <TabItem key={t.href} {...t} />
        ))}
      </View>
    </nav>,
    document.body,
  );
}

// Do not send the fixed positioning through RN/NativeWind's style interop.
// A body-level DOM element anchors it to the viewport, not a scroll surface.
const viewportStyle: CSSProperties = {
  position: "fixed",
  display: "flex",
  flexDirection: "column",
  left: 0,
  right: 0,
  bottom: 18,
  alignItems: "center",
  zIndex: 1000,
  pointerEvents: "none",
  padding: "0 16px",
};
const editorViewportStyle: CSSProperties = {
  top: "var(--dvnt-visible-bottom, 100dvh)",
  bottom: "auto",
  transform: "translateY(-100%)",
};
const mobileViewportStyle: CSSProperties = {
  bottom: 0,
  padding: 0,
};

// Web-only style props (backdrop-filter, CSS lengths) cast through `any`.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const web = (s: Record<string, unknown>) => s as any;

const styles = StyleSheet.create({
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
  // Mobile: flush to the viewport bottom, edge-to-edge, safe-area aware.
  barMobile: web({
    maxWidth: "100%",
    borderRadius: 20,
    borderLeftWidth: 0,
    borderRightWidth: 0,
    borderBottomWidth: 0,
    boxShadow: "0 -8px 24px rgba(0,0,0,0.4)",
    backgroundColor: "rgba(8,10,18,0.6)",
    height: "auto",
    minHeight: "calc(58px + env(safe-area-inset-bottom, 0px))",
    paddingTop: 8,
    paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))",
  }),
  item: {
    flex: 1,
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
});
