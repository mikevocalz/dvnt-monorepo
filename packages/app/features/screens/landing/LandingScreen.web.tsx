/**
 * DVNT landing — WEB.
 *
 * The whole page scrolls the window and every animated section drives itself
 * from GSAP ScrollTrigger (Pillars, IdentityStrip, BentoFeatureGrid, FinalCTA)
 * or GSAP quickTo (AmbientField) — "the scrollbar is the timeline", natively.
 * There is deliberately NO Reanimated on this route: its web mappers kept
 * firing per animation frame against detached view descriptors after unmount
 * (`_updatePropsJS` → Object.keys(component.props)), flooding Sentry from
 * in-app-webview traffic (DVNT-WEB-6 and siblings). gsap.context/ScrollTrigger
 * teardown is scoped per section, so no timeline can outlive its DOM.
 *
 * Native keeps the single-Animated.ScrollView + shared-scrollOffset worklet
 * architecture in LandingScreen.tsx. The header/footer on web come from the
 * persistent SiteChrome in the Next root layout.
 */
import { StyleSheet } from "react-native";
import { Main } from "@dvnt/app/components/ui/html";
import { ScreenScrollView } from "@dvnt/app/components/screen-scroll-view";
import { AmbientField } from "./sections/AmbientField";
import { Hero } from "./sections/Hero";
import { IdentityStrip } from "./sections/IdentityStrip";
import { Pillars } from "./sections/Pillars";
import { PhoneStage } from "./sections/PhoneStage";
import { BentoFeatureGrid } from "./sections/BentoFeatureGrid";
import { FinalCTA } from "./sections/FinalCTA";
import { LANDING_COLORS } from "./theme";

export function LandingScreen() {
  return (
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
  );
}

const styles = StyleSheet.create({
  webRoot: {
    position: "relative",
    minHeight: "100%",
    backgroundColor: LANDING_COLORS.bg,
    overflow: "hidden",
  },
});
