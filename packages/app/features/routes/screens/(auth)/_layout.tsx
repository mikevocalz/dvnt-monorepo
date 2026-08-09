"use client";

import { Stack } from "expo-router";
import { useAuthStore } from "@dvnt/app/lib/stores/auth-store";

export default function AuthLayout() {
  const hasSeenOnboarding = useAuthStore((state) => state.hasSeenOnboarding);

  return (
    <Stack
      // Nested navigators do NOT inherit the root Stack's contentStyle.
      screenOptions={{ headerShown: false, contentStyle: { backgroundColor: "#000" } }}
      initialRouteName={hasSeenOnboarding ? "login" : "onboarding"}
    >
      <Stack.Screen name="login" />
      <Stack.Screen name="signup" />
      <Stack.Screen name="onboarding" />
      <Stack.Screen name="forgot-password" />
      <Stack.Screen name="reset-password" />
      <Stack.Screen name="verify-email" />
    </Stack>
  );
}
