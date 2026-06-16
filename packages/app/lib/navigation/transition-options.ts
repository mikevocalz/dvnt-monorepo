import { Platform } from "react-native";
import type { NativeStackNavigationOptions } from "@react-navigation/native-stack";
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

export function dvntPostTransition(
  _postId: string,
  _motionTier: MotionTier = "full",
): NativeStackNavigationOptions {
  return buildPushTransition();
}

export function dvntEventTransition(
  _eventId: string,
  _motionTier: MotionTier = "full",
): NativeStackNavigationOptions {
  return buildPushTransition();
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
