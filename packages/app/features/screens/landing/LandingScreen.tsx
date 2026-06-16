/**
 * DVNT landing — universal screen.
 *
 * A single Animated.ScrollView owns the page; its offset (via
 * useScrollViewOffset) is the ONE shared value every section derives progress
 * from. AmbientField is a fixed backdrop, GlassHeader floats above, and the
 * scroll content is wrapped in a <Main> landmark. See
 * docs/landing-page-notes.md for the full architecture.
 *
 * Authored as one file: the per-platform pieces (Hero video, AmbientField,
 * GlassSurface) are resolved by bundler extension splits, so the composition
 * itself is identical on web and native.
 */
import { useEffect } from "react";
import { Platform, StyleSheet, View, useWindowDimensions } from "react-native";
import { Main } from "@expo/html-elements";
import Animated, {
  useAnimatedRef,
  useScrollViewOffset,
  useSharedValue,
} from "react-native-reanimated";
import { ScreenScrollView } from "@dvnt/app/components/screen-scroll-view";
import { LandingScrollContext } from "./hooks/useScrollProgress";
import { useCapabilityTier } from "./hooks/useCapabilityTier";
import { AmbientField } from "./sections/AmbientField";
import { GlassHeader } from "./sections/GlassHeader";
import { Hero } from "./sections/Hero";
import { IdentityStrip } from "./sections/IdentityStrip";
import { Pillars } from "./sections/Pillars";
import { PhoneStage } from "./sections/PhoneStage";
import { BentoFeatureGrid } from "./sections/BentoFeatureGrid";
import { FinalCTA } from "./sections/FinalCTA";
import { Footer } from "./sections/Footer";
import { LANDING_COLORS } from "./theme";

export function LandingScreen() {
  const isWeb = Platform.OS === ("web" as typeof Platform.OS);
  const scrollRef = useAnimatedRef<Animated.ScrollView>();
  const nativeScrollOffset = useScrollViewOffset(scrollRef);
  const { height } = useWindowDimensions();

  const webScrollOffset = useSharedValue(0);
  const scrollOffset =
    isWeb ? webScrollOffset : nativeScrollOffset;
  const viewportH = useSharedValue(height);
  const reduceMotion = useSharedValue(false);
  const { reduceMotion: rm } = useCapabilityTier();

  useEffect(() => {
    viewportH.value = height;
  }, [height, viewportH]);
  useEffect(() => {
    reduceMotion.value = rm;
  }, [rm, reduceMotion]);
  useEffect(() => {
    if (!isWeb || typeof window === "undefined") return;
    const syncScroll = () => {
      webScrollOffset.value = window.scrollY;
    };
    syncScroll();
    window.addEventListener("scroll", syncScroll, { passive: true });
    return () => window.removeEventListener("scroll", syncScroll);
  }, [isWeb, webScrollOffset]);

  if (isWeb) {
    return (
      <LandingScrollContext.Provider
        value={{ scrollOffset, viewportH, reduceMotion }}
      >
        <ScreenScrollView useWindowScrolling style={styles.webRoot}>
          <AmbientField />
          {/* Header comes from the persistent SiteChrome in the Next root
              layout (web). It reads window scroll for turn-to-glass here. */}
          <Main>
            <Hero />
            <IdentityStrip />
            <Pillars />
            <PhoneStage />
            <BentoFeatureGrid />
            <FinalCTA />
          </Main>
          {/* Footer comes from the persistent SiteChrome (web root layout). */}
        </ScreenScrollView>
      </LandingScrollContext.Provider>
    );
  }

  return (
    <LandingScrollContext.Provider
      value={{ scrollOffset, viewportH, reduceMotion }}
    >
      <View
        style={[
          styles.root,
          Platform.OS === "web" ? { height } : { flex: 1 },
        ]}
      >
        <AmbientField />
        <Animated.ScrollView
          ref={scrollRef}
          scrollEventThrottle={16}
          showsVerticalScrollIndicator={false}
          style={styles.scroll}
          contentContainerStyle={styles.content}
        >
          <GlassHeader />
          <Main>
            <Hero />
            <IdentityStrip />
            <Pillars />
            <PhoneStage />
            <BentoFeatureGrid />
            <FinalCTA />
          </Main>
          <Footer />
        </Animated.ScrollView>
      </View>
    </LandingScrollContext.Provider>
  );
}

const styles = StyleSheet.create({
  root: {
    backgroundColor: LANDING_COLORS.bg,
    overflow: "hidden",
  },
  webRoot: {
    position: "relative",
    minHeight: "100%",
    backgroundColor: LANDING_COLORS.bg,
    overflow: "hidden",
  },
  scroll: { flex: 1, backgroundColor: "transparent" },
  content: { backgroundColor: "transparent" },
});
