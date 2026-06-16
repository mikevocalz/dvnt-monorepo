// ============================================================
// Shared Element Transform Registry
// ============================================================
// Module-level Map connecting gesture overlays (React Native layer)
// to Skia element renderers (Canvas layer) via Reanimated shared values.
// Gestures write to shared values at 60fps on UI thread.
// Skia reads from them at render time — no bridge crossing.
// ============================================================

import type { SharedValue } from "react-native-reanimated";

export interface LiveTransform {
  translateX: SharedValue<number>;
  translateY: SharedValue<number>;
  scale: SharedValue<number>;
  rotation: SharedValue<number>; // degrees
}

// Module-level registry — no React state, no re-renders
export const liveTransformRegistry = new Map<string, LiveTransform>();
