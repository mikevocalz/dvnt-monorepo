import { useWindowDimensions } from "react-native";
import {
  resolveResponsiveGrid,
  type ResponsiveGrid,
  type ResponsiveGridOptions,
} from "./responsive-grid";

/**
 * Columns derived from the width the screen actually has, right now.
 *
 * Two bugs made every grid in the app non-responsive on a tablet, and this
 * exists so neither can come back:
 *
 * 1. FROZEN WIDTH. Several screens read `Dimensions.get("window")` at MODULE
 *    scope, which is evaluated once at import and never again. A grid built
 *    from it lays out for whatever the window was when the bundle loaded — so
 *    launching in portrait and rotating to landscape left cells sized for the
 *    old width, which is what "jumbled" looks like. `useWindowDimensions` is
 *    the reactive read; there is no correct module-scope version.
 *
 * 2. HARDCODED COLUMN COUNTS. `width >= 1024 ? 4 : 3` strands space on every
 *    device that isn't one of the sizes someone thought about: a 1366pt
 *    landscape iPad drew two columns and put the other ~290pt per side in the
 *    gutters. Columns should fall out of how many readable cards fit.
 *
 * Give it the smallest cell that is still worth showing; it returns how many
 * fit and how wide each one is once the gaps are taken out.
 */
export type { ResponsiveGrid, ResponsiveGridOptions } from "./responsive-grid";

export function useResponsiveGrid(
  options: ResponsiveGridOptions,
): ResponsiveGrid {
  const { width, height } = useWindowDimensions();
  return resolveResponsiveGrid(width, height, options);
}
