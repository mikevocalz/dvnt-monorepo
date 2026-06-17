/**
 * Floating sticky liquid-glass header.
 *
 * Turn-to-glass is a Reanimated derived value with HYSTERESIS: it engages once
 * scroll passes HEADER.engageY and only releases below HEADER.releaseY, so a
 * jittery scroll near the threshold can't flicker the glass. The glass *amount*
 * animates (scrim alpha, border, scale) over ~400ms on EASE_SETTLE — not a
 * binary class swap.
 *
 * Styling uses RN style objects (not NativeWind className) for reliable
 * cross-package universal rendering. Semantic landmarks + real anchors come
 * from @expo/html-elements.
 */
import { Platform, Pressable, StyleSheet, View, useWindowDimensions } from "react-native";
import { A, Header, Nav } from "@expo/html-elements";
import { useContext, useRef, useState, useEffect, useCallback } from "react";
// Universal routing via Solito's app-router API: usePathname() wraps
// next/navigation on web and expo-router/react-navigation on native. Replaces
// the web-vite-only @tanstack/react-router dependency.
import { usePathname, useRouter } from "solito/navigation";
import Animated, {
  interpolate,
  interpolateColor,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  withSpring,
} from "react-native-reanimated";
import Logo from "@dvnt/app/components/logo";
import { LandingScrollContext } from "../hooks/useScrollProgress";
import { GlassSurface } from "../components/GlassSurface";
import { HeaderLoginButton } from "./HeaderLoginButton";
import { HeaderDrawer } from "./HeaderDrawer";
import { clientNav } from "./client-nav";
import { EASE_SETTLE, HEADER, LANDING_COLORS, LANDING_GRADIENTS } from "../theme";

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
const HEADER_FONT_BOLD = "Republica-Minor";

export function GlassHeader({
  webWindowScroll = false,
}: {
  /** When this header lives OUTSIDE the landing scroll context (the persistent
   * header in the root layout), set true on the landing route to drive
   * turn-to-glass from window scroll. Other public routes leave it false and
   * stay always-glass (legible over content). */
  webWindowScroll?: boolean;
} = {}) {
  // No landing context → no shared scrollOffset. With webWindowScroll we start
  // transparent (top of page) and let window scroll drive the glass; otherwise
  // start glass so the header is always legible.
  const fallbackScrollOffset = useSharedValue(
    webWindowScroll ? 0 : HEADER.engageY + 1,
  );
  const landingScroll = useContext(LandingScrollContext);
  const scrollOffset =
    landingScroll?.scrollOffset ?? fallbackScrollOffset;
  const startsGlass = landingScroll == null && !webWindowScroll ? 1 : 0;

  // Drive turn-to-glass from window scroll when we're the global header on the
  // landing route (web only; no landing scroll context to read from).
  useEffect(() => {
    if (webWindowScroll === false || landingScroll != null || Platform.OS !== "web")
      return;
    const onScroll = () => {
      fallbackScrollOffset.value =
        typeof window !== "undefined" ? window.scrollY : 0;
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [webWindowScroll, landingScroll, fallbackScrollOffset]);

  // Discrete state (0/1) for hysteresis; `glass` is the animated 0..1 amount.
  const isGlass = useSharedValue(startsGlass);
  const glass = useSharedValue(startsGlass);

  useAnimatedReaction(
    () => scrollOffset.value,
    (y) => {
      if (isGlass.value === 0 && y > HEADER.engageY) {
        isGlass.value = 1;
        glass.value = withTiming(1, {
          duration: HEADER.durationMs,
          easing: EASE_SETTLE,
        });
      } else if (isGlass.value === 1 && y < HEADER.releaseY) {
        isGlass.value = 0;
        glass.value = withTiming(0, {
          duration: HEADER.durationMs,
          easing: EASE_SETTLE,
        });
      }
    },
    [scrollOffset],
  );

  // Explicit dependency arrays (no Reanimated Babel plugin in the web-vite build).
  const containerStyle = useAnimatedStyle(
    () => ({
      transform: [{ scale: interpolate(glass.value, [0, 1], [1, 0.99]) }],
    }),
    [glass],
  );

  const tintStyle = useAnimatedStyle(
    () => ({
      opacity: glass.value,
      backgroundColor: LANDING_COLORS.glassScrimStrong,
    }),
    [glass],
  );

  const borderStyle = useAnimatedStyle(
    () => ({
      borderColor: interpolateColor(
        glass.value,
        [0, 1],
        ["rgba(255,255,255,0.06)", LANDING_COLORS.glassBorderStrong],
      ),
    }),
    [glass],
  );

  // Solito's usePathname can be undefined before the native route resolves.
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
  
  const onNavItemLayout = (index: number) => (e: any) => {
    const { x, width } = e.nativeEvent.layout;
    setNavMetrics(prev => {
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
  const slideX = useSharedValue(targetMetrics.x);
  const indicatorWidth = useSharedValue(targetMetrics.width);
  const indicatorOpacity = useSharedValue(targetMetrics.opacity);

  useAnimatedReaction(
    () => activeIndex,
    (index) => {
      const metrics = getIndicatorMetrics(index);
      if (index >= 0 && metrics.opacity > 0) {
        slideX.value = withSpring(metrics.x, { damping: 20, stiffness: 180, mass: 0.6 });
        indicatorWidth.value = withSpring(metrics.width, { damping: 20, stiffness: 180, mass: 0.6 });
        indicatorOpacity.value = withSpring(1, { damping: 20, stiffness: 180 });
      } else {
        indicatorOpacity.value = withSpring(0, { damping: 20, stiffness: 150 });
        indicatorWidth.value = withSpring(0, { damping: 20, stiffness: 150 });
      }
    },
    [activeIndex, navMetrics],
  );

  const indicatorStyle = useAnimatedStyle(
    () => ({
      transform: [{ translateX: slideX.value }],
      width: indicatorWidth.value,
      opacity: indicatorOpacity.value,
    }),
    [slideX, indicatorWidth, indicatorOpacity],
  );

  const isLoginActive = currentPath.startsWith("/auth");

  // Collapse the inline nav to a hamburger + drawer on narrow viewports.
  const { width } = useWindowDimensions();
  const isMobile = width > 0 && width < 820;
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <Header style={styles.fixed}>
      <Animated.View
        pointerEvents="box-none"
        style={[styles.center, containerStyle]}
      >
        <Animated.View style={[styles.maxw, { borderRadius: isMobile ? 14 : 20 }, borderStyle]}>
          <GlassSurface radius={isMobile ? 14 : 20} blur={14} tintStyle={tintStyle as never}>
            <View style={styles.row}>
              <NavLink href="/" style={styles.brand}>
                <Logo width={92} height={36} style={{marginTop: -6}}/>
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
                  {/* Animated sliding underline — follows the measured layout of the active nav item. */}
                  <Animated.View
                    style={[styles.navIndicator, indicatorStyle]}
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
        </Animated.View>
      </Animated.View>

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

/** Animated nav text with cinematic transition when becoming active */
function NavText({ label, strong, active }: { label: string; strong?: boolean; active?: boolean }) {
  const isFirstRender = useRef(true);
  const progress = useSharedValue(active ? 1 : 0);

  useEffect(() => {
    if (isFirstRender.current) {
      isFirstRender.current = false;
      progress.value = active ? 1 : 0;
      return;
    }
    // Bouncy spring for more dramatic effect
    progress.value = withSpring(active ? 1 : 0, {
      damping: 14,
      stiffness: 180,
      mass: 0.8,
    });
  }, [active]);

  const textStyle = useAnimatedStyle(
    () => ({
      transform: [
        { translateY: interpolate(progress.value, [0, 1], [12, 0]) },
        { scale: interpolate(progress.value, [0, 1], [0.92, 1]) },
      ],
      letterSpacing: interpolate(progress.value, [0, 1], [0, 1.5]),
      opacity: interpolate(progress.value, [0, 1], [0.6, 1]),
      textShadowColor: LANDING_COLORS.cyan,
      textShadowOffset: { width: 0, height: 0 },
      textShadowRadius: interpolate(progress.value, [0, 1], [0, 8]),
    }),
    [progress],
  );

  return (
    <Animated.Text
      style={[
        styles.navText,
        strong && styles.loginText,
        active && styles.navTextActive,
        textStyle,
      ]}
      accessibilityRole="text"
    >
      {label}
    </Animated.Text>
  );
}

const GRADIENT_STYLE =
  Platform.OS === "web"
    ? // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ({ backgroundImage: LANDING_GRADIENTS.deviantCss } as any)
    : { backgroundColor: LANDING_COLORS.purple };

const styles = StyleSheet.create({
  fixed: {
    position: Platform.OS === "web" ? ("fixed" as "absolute") : "absolute",
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
  // Clear space on the right for the full-height flush Login button (width 124).
  navDesktop: { paddingRight: 140 },
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
  loginWrap: {},
  loginWrapActive: {
    transform: [{ scale: 1.02 }],
  },
  loginBtn: {
    marginLeft: 20,
    paddingHorizontal: 20,
    paddingVertical: 0,
    borderRadius: 12,
    alignItems: "center" as const,
    justifyContent: "center" as const,
    ...GRADIENT_STYLE,
  },
  loginBtnActive: {
    borderWidth: 2,
    borderColor: LANDING_COLORS.cyan,
    shadowColor: LANDING_COLORS.cyan,
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.6,
    shadowRadius: 12,
  },
  loginText: {
    color: "#0A0118",
    fontFamily: HEADER_FONT_BOLD,
    fontWeight: "900",
    // @ts-ignore - remove stroke from navText
    WebkitTextStroke: "0px",
  },
});
