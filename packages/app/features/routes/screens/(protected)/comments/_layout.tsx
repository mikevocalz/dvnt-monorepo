"use client";

import { Stack } from "expo-router";
import { COMMENT_DETENTS } from "@dvnt/app/components/sheets/AppSheet";

/**
 * Same fix as chat/_layout — see the note there.
 *
 * This rendered <CommentSheet>, i.e. the same TrueSheet navigator that threw
 * "Couldn't register the navigator" and took the whole app down from
 * chat/_layout. It had not surfaced here only because nobody had opened
 * comments since; it is the identical latent crash, not a healthy call site.
 *
 * Detents keep the original [0.42, 0.58, 0.75] ladder and the 0.75 ceiling the
 * comment sheet has always been clamped to.
 */
export default function CommentsLayout() {
  return (
    <Stack
      screenOptions={{
        headerShown: false,
        presentation: "formSheet",
        sheetAllowedDetents: [...COMMENT_DETENTS],
        sheetGrabberVisible: true,
        sheetCornerRadius: 16,
        contentStyle: { backgroundColor: "#000" },
      }}
    >
      <Stack.Screen name="index" />
      <Stack.Screen name="[postId]" />
      <Stack.Screen name="replies/[commentId]" />
    </Stack>
  );
}
