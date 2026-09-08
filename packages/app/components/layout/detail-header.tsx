/**
 * DetailHeader — the bar every pushed (non-tab) screen wears.
 *
 * Three slots: back on the left, title centred, actions on the right. The side
 * slots carry equal weight, so the title is centred on the HEADER rather than
 * on whatever the controls happen to measure — the reason a title drifts left
 * as soon as the right side gains a second button.
 *
 * It replaces three different hand-rolled shapes: a `width: 24` spacer standing
 * in for a right slot, a `flex-1` title that silently left-aligned, and
 * `justify-between` with mismatched sides. Same bar everywhere means the back
 * button is always where you reach for it.
 *
 * Safe area is NOT applied here — callers already own it, via `SafeAreaView
 * edges={["top"]}` or `paddingTop: insets.top`, and doing it in both places
 * insets twice.
 */

import React from "react";
import { View, Text, Pressable } from "react-native";
import { ArrowLeft } from "lucide-react-native";
import { useRouter } from "expo-router";
import { useColorScheme } from "@dvnt/app/lib/hooks";
import { DVNTLiquidGlassIconButton } from "@dvnt/app/components/media/DVNTLiquidGlass";


/**
 * The back button. ONE of them, for every pushed screen.
 *
 * There were three: a bare 24pt chevron, a bare 22pt one, and a 20pt chevron
 * inside a liquid-glass disc on event and post detail. Same gesture, same
 * position, three different objects — so the chrome looked like it had been
 * assembled from different apps depending on which screen you had reached.
 *
 * The glass disc wins because it is the one that survives a photo behind it:
 * event and post detail float their header over media, where a bare chevron
 * disappears against a bright flyer. Screens on a flat background lose nothing
 * by matching it.
 */
export function DetailBackButton({
  onPress,
  accessibilityLabel = "Back",
}: {
  onPress?: () => void;
  accessibilityLabel?: string;
}) {
  const router = useRouter();
  return (
    <Pressable
      onPress={onPress ?? (() => router.back())}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
    >
      <DVNTLiquidGlassIconButton size={40}>
        <ArrowLeft size={20} color="#fff" />
      </DVNTLiquidGlassIconButton>
    </Pressable>
  );
}

export function DetailHeader({
  title,
  right,
  onBack,
  showBorder = true,
}: {
  title: string;
  /** Right-hand actions. Omit for a back-and-title bar. */
  right?: React.ReactNode;
  /** Defaults to `router.back()`. */
  onBack?: () => void;
  showBorder?: boolean;
}) {
  const router = useRouter();
  const { colors } = useColorScheme();

  return (
    <View
      className={`w-full flex-row items-center px-4 py-3${
        showBorder ? " border-b border-border" : ""
      }`}
    >
      <View style={{ flex: 1, alignItems: "flex-start" }}>
        <DetailBackButton onPress={onBack} />
      </View>

      <Text
        numberOfLines={1}
        accessibilityRole="header"
        className="text-lg font-semibold text-foreground"
        // Cap the middle so a long title pushes the side slots off the bar
        // instead of wrapping under them.
        style={{ flexShrink: 1, maxWidth: "60%", textAlign: "center" }}
      >
        {title}
      </Text>

      <View
        style={{ flex: 1, alignItems: "flex-end" }}
        className="flex-row justify-end items-center gap-4"
      >
        {right}
      </View>
    </View>
  );
}
