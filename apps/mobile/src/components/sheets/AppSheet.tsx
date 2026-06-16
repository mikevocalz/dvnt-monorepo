/**
 * AppSheet — Standardized TrueSheet navigator wrapper.
 *
 * Uses the official TrueSheet API:
 * - `detents` for height control
 * - `maxContentHeight` for a hard height ceiling
 * - `grabber` + `grabberOptions` for white drag handle
 * - `cornerRadius` for rounded corners
 * - `scrollable` for proper scroll behavior
 *
 * Variants:
 * - AppSheet (default): general-purpose, detents=[0.75]
 * - CommentSheet: comment-specific, max 70% height, never full-screen
 *
 * Keep background props unset so iOS can use True Sheet's native liquid
 * glass treatment when available.
 */

import type { ReactElement, ReactNode } from "react";
import { Dimensions } from "react-native";
import TrueSheetNavigator from "@/components/navigation/true-sheet-navigator";

const SCREEN_HEIGHT = Dimensions.get("window").height;

/** Shared grabber config — white, 48×6, 10px top margin */
const GRABBER_OPTIONS = {
  width: 48,
  height: 6,
  topMargin: 10,
  color: "#FFFFFF",
} as const;

const DEFAULT_CORNER_RADIUS = 16;

// ── AppSheet (general-purpose) ───────────────────────────────────────

interface AppSheetProps {
  /** Detents array (fractional 0–1). Default: [0.75] */
  detents?: number[];
  /** Corner radius (default 16) */
  cornerRadius?: number;
  /** Enable scrollable content pinning (default true) */
  scrollable?: boolean;
  /** Fixed header element rendered above scrollable content */
  header?: ReactElement;
  /** Optional route screen declarations */
  children?: ReactNode;
  /** Explicit base route for sheet navigator */
  initialRouteName?: string;
}

export default function AppSheet({
  detents = [0.75],
  cornerRadius = DEFAULT_CORNER_RADIUS,
  scrollable = true,
  header,
  children,
  initialRouteName,
}: AppSheetProps) {
  return (
    <TrueSheetNavigator
      initialRouteName={initialRouteName}
      screenOptions={
        {
          detents,
          detentIndex: detents.length - 1,
          cornerRadius,
          grabber: true,
          grabberOptions: GRABBER_OPTIONS,
          scrollable,
          ...(header ? { header } : {}),
        } as any
      }
    >
      {children}
    </TrueSheetNavigator>
  );
}

// ── CommentSheet (comment-specific, max 70%) ─────────────────────────
//
// Keep the comment sheet below full-screen and explicitly dismissible.
// We intentionally avoid setting custom background props here so the
// native True Sheet liquid glass styling stays enabled where supported.

export const COMMENT_DETENTS = [0.42, 0.58, 0.75] as const;
const COMMENT_MAX_FRACTION = COMMENT_DETENTS[COMMENT_DETENTS.length - 1];
const COMMENT_MAX_HEIGHT = Math.round(SCREEN_HEIGHT * COMMENT_MAX_FRACTION);

interface CommentSheetProps {
  /**
   * Detents for the comment sheet. All numeric values are clamped to <= 0.75.
   * Default: [0.42, 0.58, 0.75]
   */
  detents?: number[];
  /** Corner radius (default 16) */
  cornerRadius?: number;
  /** Fixed header element rendered above scrollable content */
  header?: ReactElement;
  /** Optional route screen declarations */
  children?: ReactNode;
  /** Explicit base route for sheet navigator */
  initialRouteName?: string;
}

export function CommentSheet({
  detents = [...COMMENT_DETENTS],
  cornerRadius = DEFAULT_CORNER_RADIUS,
  header,
  children,
  initialRouteName,
}: CommentSheetProps) {
  // Clamp all numeric detents to <= 0.75
  const clampedDetents = [...new Set(detents.map((d) => Math.min(d, COMMENT_MAX_FRACTION)))].sort(
    (left, right) => left - right,
  );

  // initialDetentIndex points at the largest detent (last in sorted array)
  const initialIdx = clampedDetents.length - 1;

  return (
    <TrueSheetNavigator
      initialRouteName={initialRouteName}
      screenOptions={
        {
          detents: clampedDetents,
          detentIndex: initialIdx,
          maxContentHeight: COMMENT_MAX_HEIGHT,
          cornerRadius,
          dismissible: true,
          draggable: true,
          grabber: true,
          grabberOptions: GRABBER_OPTIONS,
          scrollable: true,
          insetAdjustment: "automatic",
          scrollableOptions: {
            keyboardDismissMode: "interactive",
            keyboardShouldPersistTaps: "handled",
          },
          dimmed: true,
          ...(header ? { header } : {}),
        } as any
      }
    >
      {children}
    </TrueSheetNavigator>
  );
}
