/**
 * App Store-style card → detail zoom, in the one shape expo-router accepts.
 *
 * The rules here are load-bearing, not stylistic (see the
 * `expo-router-app-store-card-transition` skill):
 *
 *  - `<Link asChild>` is required. The router threads the zoom through the href
 *    itself, rewriting it with a source id the destination reads off its route
 *    params. `router.push` gets no zoom at all, and `Link.AppleZoom` throws
 *    without `asChild`.
 *  - `Link.AppleZoom` takes exactly ONE child. More than one warns and renders
 *    nothing, so the whole card goes in a single wrapper view.
 *  - No press-scale on the card. A shrink transform fights the zoom for the same
 *    frame — the zoom IS the feedback. A selection haptic is the whole affordance.
 *
 * iOS 18+ gets the zoom; everywhere else this degrades to a plain stack push,
 * which is why there is no platform branch in the callers.
 *
 * ponytail: `disabled` falls back to a bare Pressable rather than trying to
 * cancel a Link mid-press — a guest tap must open the auth sheet, not navigate,
 * and there is no way to veto a Link's navigation after the fact.
 */

import React from "react";
import { Pressable } from "react-native";
import { Link } from "expo-router";
import type { Href } from "expo-router";
import * as Haptics from "expo-haptics";

type Props = {
  /** Where the card opens. Ignored when `disabled`. */
  href: Href;
  /** Runs alongside navigation — prefetch, analytics. Not a place to veto. */
  onPress?: () => void;
  /** Guest mode / gated: render a plain Pressable and never navigate. */
  disabled?: boolean;
  /** Called instead of navigating when `disabled`. */
  onDisabledPress?: () => void;
  children: React.ReactNode;
};

export function ZoomCard({
  href,
  onPress,
  disabled,
  onDisabledPress,
  children,
}: Props) {
  if (disabled) {
    return <Pressable onPress={onDisabledPress}>{children}</Pressable>;
  }

  return (
    <Link href={href} asChild>
      <Pressable
        onPress={() => {
          void Haptics.selectionAsync().catch(() => {});
          onPress?.();
        }}
      >
        <Link.AppleZoom>{children}</Link.AppleZoom>
      </Pressable>
    </Link>
  );
}

/**
 * Marks the rect the card flies into. Wrap the destination's hero image — with
 * no target the card expands into the whole screen instead of the picture
 * landing in place.
 */
export function ZoomTarget({ children }: { children: React.ReactNode }) {
  return <Link.AppleZoomTarget>{children}</Link.AppleZoomTarget>;
}
