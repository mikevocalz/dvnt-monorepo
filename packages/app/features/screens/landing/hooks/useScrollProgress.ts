/**
 * Single-offset scroll architecture.
 *
 * One Animated.ScrollView owns the page and feeds exactly one `scrollOffset`
 * shared value — "the scrollbar is the timeline" (GSAP ScrollTrigger mental
 * model, translated to Reanimated). Every section derives its own 0→1 progress
 * from that offset + its measured layout, entirely in worklets. No setState /
 * runOnJS in the scroll path.
 */
import { createContext, useContext } from "react";
import type { LayoutChangeEvent } from "react-native";
import {
  Extrapolation,
  interpolate,
  useDerivedValue,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

export interface LandingScrollValue {
  /** Vertical scroll offset of the single page ScrollView (px). The timeline. */
  scrollOffset: SharedValue<number>;
  /** Current viewport height (px) — kept in a shared value for worklet access. */
  viewportH: SharedValue<number>;
  /** Whether motion should be suppressed (reduce-motion / low tier). */
  reduceMotion: SharedValue<boolean>;
}

export const LandingScrollContext = createContext<LandingScrollValue | null>(
  null,
);

export function useLandingScroll(): LandingScrollValue {
  const ctx = useContext(LandingScrollContext);
  if (!ctx) {
    throw new Error("useLandingScroll must be used within a LandingScreen");
  }
  return ctx;
}

export interface SectionProgress {
  /** Attach to the section's outer View. */
  onLayout: (e: LayoutChangeEvent) => void;
  /**
   * 0 before the section enters the viewport, ~0.5 when centered, 1 after it
   * has fully passed. Clamped. Drives parallax / scrub.
   */
  progress: SharedValue<number>;
  /** 0→1 as the section's top travels from one viewport below into view. */
  enter: SharedValue<number>;
  /** Measured top (px) of the section within the scroll content. */
  top: SharedValue<number>;
  /** Measured height (px) of the section. */
  height: SharedValue<number>;
}

/**
 * Measures a section via onLayout and returns worklet-driven progress values
 * derived from the shared scrollOffset. Pass the result's `progress`/`enter`
 * into useAnimatedStyle interpolations for parallax and entrances.
 */
export function useSectionProgress(): SectionProgress {
  const { scrollOffset, viewportH } = useLandingScroll();
  const top = useSharedValue(0);
  const height = useSharedValue(1);

  const onLayout = (e: LayoutChangeEvent) => {
    top.value = e.nativeEvent.layout.y;
    height.value = Math.max(1, e.nativeEvent.layout.height);
  };

  // Explicit dependency arrays (no Reanimated Babel plugin in the web-vite build).
  const progress = useDerivedValue(() => {
    const vh = viewportH.value;
    return interpolate(
      scrollOffset.value,
      [top.value - vh, top.value, top.value + height.value],
      [0, 0.5, 1],
      Extrapolation.CLAMP,
    );
  }, [scrollOffset, viewportH, top, height]);

  const enter = useDerivedValue(() => {
    const vh = viewportH.value;
    return interpolate(
      scrollOffset.value,
      [top.value - vh, top.value - vh * 0.35],
      [0, 1],
      Extrapolation.CLAMP,
    );
  }, [scrollOffset, viewportH, top]);

  return { onLayout, progress, enter, top, height };
}
