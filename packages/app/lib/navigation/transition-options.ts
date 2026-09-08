import { Platform } from "react-native";
import type { TransitionStackOptions as NativeStackNavigationOptions } from "@dvnt/app/lib/navigation/transition-stack";
import type { MotionTier } from "@dvnt/app/lib/navigation/use-motion-tier";

function buildPushTransition(): NativeStackNavigationOptions {
  return {
    animation: Platform.OS === "ios" ? "slide_from_right" : "fade_from_bottom",
    animationDuration: Platform.OS === "ios" ? 240 : 180,
    gestureEnabled: true,
    gestureDirection: "horizontal",
    contentStyle: { backgroundColor: "#000" },
  };
}

/**
 * Destinations reached by the App Store card zoom (`ZoomCard` → `ZoomTarget`).
 *
 * These must NOT declare a screen animation. `buildPushTransition` forced
 * `slide_from_right` at 240ms, so the stack slid the screen in while
 * Link.AppleZoom was zooming the card into it — two animations competing for
 * the same frames, which is what made the push AND the back feel broken rather
 * than merely plain. The zoom owns the transition; the stack gets out of its
 * way and falls back to the platform default when there is no zoom (Android,
 * pre-iOS-18, or a plain push).
 *
 * `title: ""` is required by the same pattern: it leaves the nav bar as just
 * the chevron so the hero can sit under a transparent header.
 */
function buildZoomDestination(): NativeStackNavigationOptions {
  return {
    title: "",
    gestureEnabled: true,
    gestureDirection: "horizontal",
    contentStyle: { backgroundColor: "#000" },
  };
}

export function dvntPostTransition(
  _postId: string,
  _motionTier: MotionTier = "full",
): NativeStackNavigationOptions {
  return buildZoomDestination();
}

export function dvntEventTransition(
  _eventId: string,
  _motionTier: MotionTier = "full",
): NativeStackNavigationOptions {
  return buildZoomDestination();
}

export function dvntTicketTransition(
  _ticketId: string,
  _motionTier: MotionTier = "full",
): NativeStackNavigationOptions {
  return {
    ...buildPushTransition(),
    presentation: "card",
  };
}

export function dvntStoryTransition(
  _storyId: string,
  _motionTier: MotionTier = "full",
): NativeStackNavigationOptions {
  return {
    headerShown: false,
    presentation: "fullScreenModal",
    gestureEnabled: true,
    gestureDirection: "vertical",
    contentStyle: { backgroundColor: "#000" },
    animation: Platform.OS === "ios" ? "slide_from_bottom" : "fade_from_bottom",
    animationDuration: Platform.OS === "ios" ? 260 : 200,
  };
}
