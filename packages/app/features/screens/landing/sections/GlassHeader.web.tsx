/**
 * Floating sticky liquid-glass header — WEB.
 *
 * Same design contract as the native GlassHeader.tsx (turn-to-glass with
 * HYSTERESIS: engages past HEADER.engageY, releases below HEADER.releaseY, the
 * glass *amount* eased over ~400ms on the settle curve; sliding nav underline;
 * kinetic nav text) — but implemented with React state + CSS transitions
 * instead of Reanimated. This header is persistent chrome on every marketing
 * route: Reanimated's web mappers kept running per animation frame after
 * unmount/remount (the SiteChrome error boundary remounts it on crash) and
 * fired `_updatePropsJS` against detached view descriptors — the DVNT-WEB-6
 * Sentry flood. CSS transitions are declarative: nothing can run detached.
 *
 * Styling uses RN style objects (react-native-web ≥0.19 forwards the
 * transition* style props) for reliable cross-package universal rendering.
 */
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { A, Header, Nav } from "@expo/html-elements";
import { useState, useEffect } from "react";
// Universal routing via Solito's app-router API (see GlassHeader.tsx).
import { usePathname, useRouter } from "solito/navigation";
import Logo from "@dvnt/app/components/logo";
import { GlassSurface } from "../components/GlassSurface";
import { HeaderLoginButton } from "./HeaderLoginButton";
import { HeaderDrawer } from "./HeaderDrawer";
import { clientNav } from "./client-nav";
import { EASE_SETTLE_CSS, HEADER, LANDING_COLORS } from "../theme";

const NAV = [
  { label: "Home", href: "/" },
  { label: "Events", href: "/events" },
  // The blog is this same app served at blog.dvntapp.live in prod; /posts is the
  // route on whatever host serves it, so an internal link resolves correctly.
  { label: "Blog", href: "/posts" },
  { label: "Pricing", href: "/pricing" },
  { label: "Privacy", href: "/privacy" },
  { label: "FAQ", href: "/faq" },
];
const HEADER_FONT = "Republica-Minor";

/** Glass engage/release ease — the same settle curve the worklet used. */
const GLASS_TRANSITION = {
  transitionDuration: `${HEADER.durationMs}ms`,
  transitionTimingFunction: EASE_SETTLE_CSS,
} as const;

/** CSS stand-in for withSpring(damping 20, stiffness 180, mass 0.6) — near
 * critically damped, so the settle curve reads the same. */
const INDICATOR_TRANSITION = {
  transitionProperty: "transform, width, opacity",
  transitionDuration: "450ms",
  transitionTimingFunction: EASE_SETTLE_CSS,
} as const;

export function GlassHeader({
  webWindowScroll = false,
}: {
  /** True on the landing route: window scroll drives turn-to-glass. Other
   * public routes leave it false and stay always-glass (legible over content). */
  webWindowScroll?: boolean;
} = {}) {
  // Discrete glass state with hysteresis — the *amount* animates via the CSS
  // transitions below, so a jittery scroll near the threshold can't flicker.
  const [glassOn, setGlassOn] = useState(!webWindowScroll);

  useEffect(() => {
    if (!webWindowScroll || typeof window === "undefined") {
      setGlassOn(true);
      return;
    }
    const onScroll = () => {
      const y = window.scrollY;
      // Engage above engageY, release only below releaseY (hysteresis).
      setGlassOn((prev) => (prev ? y >= HEADER.releaseY : y > HEADER.engageY));
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [webWindowScroll]);

  // Solito's usePathname can be undefined before the route resolves.
  const currentPath = usePathname() ?? "/";

  // Derive the active index straight from NAV order so the sliding underline
  // never drifts when nav items are added/reordered. Home matches only "/";
  // every other item matches its href prefix (e.g. /events, /events/abc → Events).
  const getActiveIndex = () => {
    if (currentPath === "/") return 0;
    return NAV.findIndex(
      (item) => item.href !== "/" && currentPath.startsWith(item.href),
    );
  };

  const activeIndex = getActiveIndex();

  // Store measured positions and widths for each nav item
  const [navMetrics, setNavMetrics] = useState<{ x: number; width: number }[]>([]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const onNavItemLayout = (index: number) => (e: any) => {
    const { x, width } = e.nativeEvent.layout;
    setNavMetrics((prev) => {
      const next = [...prev];
      // x is relative to the Nav container
      next[index] = { x, width };
      return next;
    });
  };

  const getIndicatorMetrics = (index: number) => {
    if (index < 0 || index >= NAV.length || !navMetrics[index]) {
      return { x: -100, width: 0, opacity: 0 };
    }
    return { x: navMetrics[index].x, width: navMetrics[index].width, opacity: 1 };
  };

  const targetMetrics = getIndicatorMetrics(activeIndex);

  const isLoginActive = currentPath.startsWith("/auth");

  // Collapse the inline nav to a hamburger + drawer on narrow viewports.
  const { width } = useWindowDimensions();
  const isMobile = width > 0 && width < 820;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Header style={styles.fixed}>
      <View
        pointerEvents="box-none"
        style={[
          styles.center,
          {
            transform: [{ scale: glassOn ? 0.99 : 1 }],
            transitionProperty: "transform",
            ...GLASS_TRANSITION,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
        ]}
      >
        <View
          style={[
            styles.maxw,
            { borderRadius: isMobile ? 14 : 20 },
            {
              borderColor: glassOn
                ? LANDING_COLORS.glassBorderStrong
                : "rgba(255,255,255,0.06)",
              transitionProperty: "border-color",
              ...GLASS_TRANSITION,
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
            } as any,
          ]}
        >
          <GlassSurface
            radius={isMobile ? 14 : 20}
            blur={14}
            tintStyle={
              {
                opacity: glassOn ? 1 : 0,
                backgroundColor: LANDING_COLORS.glassScrimStrong,
                transitionProperty: "opacity",
                ...GLASS_TRANSITION,
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
              } as any
            }
          >
            <View style={styles.row}>
              <NavLink href="/" style={styles.brand}>
                <Logo width={92} height={36} style={{ marginTop: -6 }} />
              </NavLink>

              {isMobile ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Open menu"
                  onPress={() => setMenuOpen(true)}
                  style={styles.burger}
                >
                  <View style={styles.burgerLine} />
                  <View style={[styles.burgerLine, styles.burgerLineMid]} />
                  <View style={styles.burgerLine} />
                </Pressable>
              ) : (
                <Nav style={styles.nav}>
                  {/* Sliding underline — follows the measured layout of the active nav item. */}
                  <View
                    style={[
                      styles.navIndicator,
                      {
                        transform: [{ translateX: targetMetrics.x }],
                        width: targetMetrics.width,
                        opacity: targetMetrics.opacity,
                        ...INDICATOR_TRANSITION,
                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                      } as any,
                    ]}
                    pointerEvents="none"
                  />
                  {NAV.map((item, index) => (
                    <View
                      key={item.label}
                      style={styles.navLink}
                      onLayout={onNavItemLayout(index)}
                    >
                      <NavLink href={item.href}>
                        <NavText label={item.label} active={index === activeIndex} />
                      </NavLink>
                    </View>
                  ))}
                  <HeaderLoginButton active={isLoginActive} />
                </Nav>
              )}
            </View>
          </GlassSurface>
        </View>
      </View>

      <HeaderDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        items={NAV}
        pathname={currentPath}
      />
    </Header>
  );
}

/**
 * Anchor that navigates CLIENT-SIDE via Solito's App-Router router. A plain
 * <A href> does a full document load on web, which remounts the whole app
 * (incl. this persistent header) and re-runs its entrance animation — the
 * "header jumps on every tab change" bug. We keep the real href (SEO,
 * middle-click) but intercept plain left-clicks → router.push.
 *
 * (NB: solito/link's useLink is pages-router based and crashes under the App
 * Router, so we use useRouter from solito/navigation.)
 */
function NavLink({
  href,
  style,
  children,
}: {
  href: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  style?: any;
  children: React.ReactNode;
}) {
  const router = useRouter();
  return (
    <A href={href} onPress={clientNav(router, href) as never} style={style}>
      {children}
    </A>
  );
}

/** CSS stand-in for the nav text's withSpring(damping 14, stiffness 180,
 * mass 0.8) — underdamped, so keep a touch of overshoot in the bezier. */
const NAV_TEXT_TRANSITION = {
  transitionProperty: "transform, opacity, letter-spacing, text-shadow",
  transitionDuration: "400ms",
  transitionTimingFunction: "cubic-bezier(0.34, 1.4, 0.64, 1)",
} as const;

// Rest / active poses — the same values the old worklet interpolated between.
const NAV_TEXT_REST = {
  ...NAV_TEXT_TRANSITION,
  transform: [{ translateY: 12 }, { scale: 0.92 }],
  letterSpacing: 0,
  opacity: 0.6,
  textShadowColor: LANDING_COLORS.cyan,
  textShadowOffset: { width: 0, height: 0 },
  textShadowRadius: 0,
} as const;
const NAV_TEXT_ACTIVE = {
  ...NAV_TEXT_TRANSITION,
  transform: [{ translateY: 0 }, { scale: 1 }],
  letterSpacing: 1.5,
  opacity: 1,
  textShadowColor: LANDING_COLORS.cyan,
  textShadowOffset: { width: 0, height: 0 },
  textShadowRadius: 8,
} as const;

/** Nav text with the cinematic active transition (pure CSS — first paint lands
 * directly on the final pose, so nothing animates on mount). */
function NavText({ label, active }: { label: string; active?: boolean }) {
  return (
    <Text
      style={[
        styles.navText,
        active && styles.navTextActive,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (active ? NAV_TEXT_ACTIVE : NAV_TEXT_REST) as any,
      ]}
      accessibilityRole="text"
    >
      {label}
    </Text>
  );
}

const styles = StyleSheet.create({
  fixed: {
    position: "fixed" as "absolute",
    top: 0,
    left: 0,
    right: 0,
    zIndex: 100,
    paddingHorizontal: 16,
    paddingTop: 14,
  },
  center: { width: "100%", alignItems: "center" },
  maxw: {
    width: "100%",
    maxWidth: 1536,
    borderRadius: 20,
    borderWidth: 1,
    position: "relative",
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 18,
    paddingVertical: 6,
  },
  brand: { flexDirection: "row", alignItems: "center" },
  nav: { flexDirection: "row", alignItems: "center", gap: 22, position: "relative" as const },
  burger: {
    width: 44,
    height: 38,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    gap: 5,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.16)",
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  burgerLine: {
    width: 18,
    height: 2,
    borderRadius: 2,
    backgroundColor: LANDING_COLORS.text,
  },
  burgerLineMid: { width: 12, alignSelf: "center", backgroundColor: LANDING_COLORS.cyan },
  navIndicator: {
    position: "absolute",
    bottom: -2,
    left: 0,
    height: 3,
    backgroundColor: LANDING_COLORS.cyan,
    borderRadius: 2,
    zIndex: 10,
  },
  navLink: {
    paddingVertical: 4,
    paddingHorizontal: 10,
    alignItems: "center" as const,
  },
  navText: {
    fontFamily: HEADER_FONT,
    color: LANDING_COLORS.textSecondary,
    fontSize: 16,
    letterSpacing: 1,
    // @ts-ignore - webkitTextStroke works on web
    WebkitTextStroke: "1px rgba(0,0,0,0.9)",
  },
  navTextActive: {
    color: LANDING_COLORS.cyan,
    fontWeight: "700",
    // @ts-ignore - webkitTextStroke works on web
    WebkitTextStroke: "1px rgba(0,0,0,0.9)",
  },
});
