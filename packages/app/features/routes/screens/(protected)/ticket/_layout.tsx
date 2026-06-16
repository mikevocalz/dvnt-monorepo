"use client";

import { Stack } from "expo-router";

export default function TicketLayout() {
  return (
    <Stack
      screenOptions={{
        presentation: "modal",
        headerShown: false,
        contentStyle: { backgroundColor: "transparent" },
      }}
    />
  );
}
