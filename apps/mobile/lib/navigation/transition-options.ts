import { Platform } from "react-native";
import type { ComponentProps } from "react";
import { Stack } from "expo-router";
import type { MotionTier } from "@/lib/navigation/use-motion-tier";

type StackScreenOptions = Exclude<
  NonNullable<ComponentProps<typeof Stack.Screen>["options"]>,
  (...args: any[]) => any
>;

function buildPushTransition(): StackScreenOptions {
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
): StackScreenOptions {
  return buildPushTransition();
}

export function dvntEventTransition(
  _eventId: string,
  _motionTier: MotionTier = "full",
): StackScreenOptions {
  return buildPushTransition();
}

export function dvntTicketTransition(
  _ticketId: string,
  _motionTier: MotionTier = "full",
): StackScreenOptions {
  return {
    ...buildPushTransition(),
    presentation: "card",
  };
}

export function dvntStoryTransition(
  _storyId: string,
  _motionTier: MotionTier = "full",
): StackScreenOptions {
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
