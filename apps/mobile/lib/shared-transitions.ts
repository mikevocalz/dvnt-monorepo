/**
 * Shared Element Transitions — Config & Utilities
 *
 * Central module for Instagram-grade shared element transitions.
 * Uses Reanimated 4 SharedTransition API with native-stack.
 *
 * Spring presets tuned for premium iOS/Android feel:
 * - heroImage: Big feed/event images → detail screens
 * - avatar: Small circular avatars → profile headers
 * - snappy: Quick UI elements (badges, small icons)
 *
 * IMPORTANT: sharedTransitionTag only works with native-stack screens.
 * Tab navigator and modal presentations do NOT support shared transitions.
 *
 * See: https://docs.swmansion.com/react-native-reanimated/docs/shared-element-transitions/overview/
 */

import { Platform } from "react-native";
import { SharedTransition } from "react-native-reanimated";

// ── Spring Presets (Instagram-tuned) ─────────────────────────────────

/**
 * "Big hero image" — feed post / event card → detail screen.
 * Slight overshoot for organic feel. Damping 24 settles cleanly.
 */
export const heroImageTransition = SharedTransition.duration(400)
  .springify()
  .damping(24)
  .stiffness(200)
  .mass(1.0)
  .overshootClamping(0);

/**
 * "Snappy avatar" — small circular elements.
 * Higher stiffness = faster snap. Overshoot clamped on Android
 * to avoid shape distortion during circle→circle morph.
 */
export const avatarTransition = SharedTransition.duration(350)
  .springify()
  .damping(22)
  .stiffness(280)
  .mass(0.9)
  .overshootClamping(Platform.OS === "android" ? 1 : 0);

/**
 * "Quick snappy" — badges, small UI elements.
 * Fast with minimal overshoot.
 */
export const snappyTransition = SharedTransition.duration(300)
  .springify()
  .damping(26)
  .stiffness(320)
  .mass(0.8)
  .overshootClamping(1);

/**
 * Default transition — balanced for general use.
 */
export const defaultTransition = SharedTransition.duration(380)
  .springify()
  .damping(20)
  .stiffness(220)
  .mass(1.0)
  .overshootClamping(0);

// ── Tag Helpers ──────────────────────────────────────────────────────
// Deterministic, stable, unique tags. NEVER use array index.

export const sharedTags = {
  // Feed/Profile post → Post detail
  postMedia: (postId: string) => `post-media-${postId}`,
  postAvatar: (postId: string) => `post-avatar-${postId}`,

  // Event card → Event detail
  eventImage: (eventId: string | number) => `event-image-${eventId}`,
  eventTitle: (eventId: string | number) => `event-title-${eventId}`,

  // Profile avatar → Profile screen
  profileAvatar: (userId: string) => `profile-avatar-${userId}`,

  // Story thumbnail → Story viewer
  storyThumb: (storyId: string) => `story-thumb-${storyId}`,

  // Messages → Chat (for future native-stack migration)
  conversationAvatar: (convId: string) => `conversation-${convId}-avatar`,
  conversationName: (convId: string) => `conversation-${convId}-name`,
} as const;

// ── Android Stacking Fix ─────────────────────────────────────────────
// Android needs elevation (not just zIndex) for correct draw order
// during shared element transitions. Apply to shared element wrappers.

export const androidElevationFix = Platform.select({
  android: {
    position: "relative" as const,
    zIndex: 9999,
    elevation: 9999,
  },
  default: {},
});

// ── Anti-Flicker Checklist (enforced by component design) ────────────
//
// 1. sharedTransitionTag matches EXACTLY between source and destination
// 2. Shared element exists on FIRST render of destination (no conditional)
// 3. No key changes during transition
// 4. No onLayout → setState that changes size during transition
// 5. Image source memoized (no new object identity each render)
// 6. No overflow: 'hidden' on parent of shared element (Android)
// 7. borderRadius on shared element itself, not nested wrappers
// 8. No live shadows/elevation on the shared element during transition
// 9. List row doesn't unmount during navigation (stable height, no clipping)
// 10. Preload destination data before navigation (cache-first pattern)
