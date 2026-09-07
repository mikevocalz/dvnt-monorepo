import { useWindowDimensions } from "react-native";

/** max-w-3xl. Same breakpoint as `useIsLargeScreen`. */
export const MAX_SHEET_WIDTH = 768;
/** Detached lift, per the gorhom detached-sheet docs. */
export const SHEET_BOTTOM_INSET = 46;
/** The docs' horizontal gutter, and the floor once the width cap bites. */
const SHEET_GUTTER = 24;
/** 3:4 width-to-height, so the sheet is portrait. */
const SHEET_HEIGHT_RATIO = 4 / 3;

export interface SheetMetrics {
  width: number;
  /** Use as a numeric snap point. */
  height: number;
  /** Equal margins centre the sheet; collapses to the gutter below the cap. */
  marginHorizontal: number;
}

/**
 * Pure so it can be asserted without a renderer — see `sheet-metrics.test.ts`.
 * Height is clamped because a true 3:4 box does not clear the detached inset
 * on a short landscape iPad.
 */
export function detachedSheetMetrics(
  windowWidth: number,
  windowHeight: number,
): SheetMetrics {
  const width = Math.min(windowWidth - SHEET_GUTTER * 2, MAX_SHEET_WIDTH);
  const height = Math.min(
    width * SHEET_HEIGHT_RATIO,
    windowHeight * 0.92 - SHEET_BOTTOM_INSET,
  );
  return { width, height, marginHorizontal: (windowWidth - width) / 2 };
}

export function useDetachedSheetMetrics(): SheetMetrics {
  const { width, height } = useWindowDimensions();
  return detachedSheetMetrics(width, height);
}
