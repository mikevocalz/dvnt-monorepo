"use client";

import TrueSheetNavigator from "@dvnt/app/components/navigation/true-sheet-navigator";
import { CommentSheet } from "@dvnt/app/src/components/sheets/AppSheet";

export default function CommentsLayout() {
  return (
    <CommentSheet initialRouteName="index">
      <TrueSheetNavigator.Screen name="index" />
      <TrueSheetNavigator.Screen name="[postId]" />
      <TrueSheetNavigator.Screen name="replies/[commentId]" />
    </CommentSheet>
  );
}
