/**
 * `useResponsiveGrid` — WEB variant. Same contract, same maths, different read.
 *
 * The native hook reads the viewport through react-native's
 * `useWindowDimensions`, which a web screen must not import (Law 3). The
 * browser's own equivalent is `window.innerWidth/innerHeight` plus a `resize`
 * listener, so that is what this subscribes to. Both sides call the identical
 * `resolveResponsiveGrid`, so a tablet-width browser and a tablet get the same
 * column count — which is the whole point of the hook.
 *
 * `useSyncExternalStore` rather than `useState` + `useEffect`: it gives the
 * server render a defined width instead of a hydration mismatch, and React
 * handles the tear-free read. The SSR snapshot is 1024 — a desktop-ish width,
 * because the first paint of a desktop page showing one phone-width column and
 * then snapping to four is worse than the reverse.
 */

import { useCallback, useSyncExternalStore } from "react";
import {
  resolveResponsiveGrid,
  type ResponsiveGrid,
  type ResponsiveGridOptions,
} from "./responsive-grid";

export type { ResponsiveGrid, ResponsiveGridOptions } from "./responsive-grid";

/** Width assumed while there is no window (SSR / prerender). */
const SSR_WIDTH = 1024;
const SSR_HEIGHT = 768;

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("resize", onChange);
  window.addEventListener("orientationchange", onChange);
  return () => {
    window.removeEventListener("resize", onChange);
    window.removeEventListener("orientationchange", onChange);
  };
}

// A snapshot has to be referentially stable between resizes or
// useSyncExternalStore re-renders forever, so the store hands back a packed
// number and the hook unpacks it. Height only decides orientation, so 16 bits
// of each is ample and keeps the value a primitive.
function getSnapshot(): number {
  if (typeof window === "undefined") return SSR_WIDTH * 65536 + SSR_HEIGHT;
  return (
    Math.min(65535, window.innerWidth) * 65536 +
    Math.min(65535, window.innerHeight)
  );
}

function getServerSnapshot(): number {
  return SSR_WIDTH * 65536 + SSR_HEIGHT;
}

export function useResponsiveGrid(
  options: ResponsiveGridOptions,
): ResponsiveGrid {
  const packed = useSyncExternalStore(
    useCallback(subscribe, []),
    getSnapshot,
    getServerSnapshot,
  );
  return resolveResponsiveGrid(
    Math.floor(packed / 65536),
    packed % 65536,
    options,
  );
}
