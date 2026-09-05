// ============================================================
// Canvas Kit Adapter — pinned dependency contract
// ============================================================
// The story editor consumes react-native-canvas-kit through the ONE
// adapter module in this directory so the dependency stays swappable.
// This file pins the exact version we audited against and records the
// peer ranges verified in docs/story-editor-v2-baseline.md §2.
// ============================================================

/** Exact version audited/pinned for WS-1. Bump only with a re-audit. */
export const CANVAS_KIT_VERSION = "1.1.0" as const;

/**
 * Peer ranges declared by react-native-canvas-kit@1.1.0, paired with the
 * versions installed in this monorepo (all satisfied — see baseline §2).
 * The kit's runtime `assertReanimatedVersion()` additionally throws unless
 * reanimated major === 4; our 4.5.3 passes.
 */
export const CANVAS_KIT_PEERS = {
  "@shopify/react-native-skia": { range: ">=1.0.0", installed: "2.6.2" },
  "react-native-gesture-handler": { range: ">=2.0.0", installed: "~2.32.0" },
  "react-native-reanimated": { range: "^4.0.0", installed: "4.5.3" },
  "react-native-worklets": { range: ">=0.5.0", installed: "0.11.3" },
} as const;
