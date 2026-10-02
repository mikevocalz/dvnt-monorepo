"use client";

import { GameTable } from "./game-table.web";
import {
  ThreeTableBoundary,
  ThreeTableScene,
  WebGLAvailable,
} from "./three-table-scene.web";
import type { GameTableProps } from "./types";

/**
 * The Cookout spec calls for dimensional three.js cards; on web that means a
 * WebGL2 renderer drawing real card meshes with the printed face anatomy and
 * back art. The module pulls three in lazily (inside init), so the baseline
 * bundle never pays for it, and any init fault falls back to the CanvasKit
 * scene — which stays the guaranteed renderer on webviews without WebGL2.
 */
export async function canUseEnhanced(): Promise<boolean> {
  return WebGLAvailable();
}

export function EnhancedTable(props: GameTableProps) {
  return (
    <ThreeTableBoundary fallback={<GameTable {...props} />}>
      <ThreeTableScene {...props} />
    </ThreeTableBoundary>
  );
}
