/**
 * Reanimated 4 / Motion presets. Use these instead of declaring damping
 * and stiffness inline so animations across the app feel consistent.
 *
 * Usage:
 *   import { motion } from "@/lib/theme";
 *   import { withSpring } from "react-native-reanimated";
 *   scale.value = withSpring(1, motion.spring);
 *
 *   // Or with @legendapp/motion:
 *   <Motion.View transition={{ type: "spring", ...motion.spring }} />
 */

export const motion = {
  /** Standard UI transitions — sheet open, navigation transitions. */
  spring: { damping: 18, stiffness: 200, mass: 1 },

  /** Snappy responses — button press, toggle, haptic-paired feedback. */
  snap: { damping: 25, stiffness: 400, mass: 0.9 },

  /** Gentle reveals — modal/sheet enter, hero reveal, parallax. */
  reveal: { damping: 22, stiffness: 180, mass: 1 },

  /** Celebratory bounce — success states, confirmation chips. Use sparingly. */
  bounce: { damping: 12, stiffness: 240, mass: 0.8 },

  /** Non-spring durations (ms) for timing-based animations. */
  fast: 150,
  medium: 250,
  slow: 400,

  /**
   * Reduce-Motion fallback. Test with iOS Settings → Accessibility →
   * Motion → Reduce Motion ON. Honor this in any wrapper that produces
   * a non-spring animation:
   *   const reduce = useReducedMotion();
   *   const duration = reduce ? motion.reducedMotion.duration : motion.medium;
   */
  reducedMotion: { duration: 100 },
} as const;

export type MotionName = keyof typeof motion;
