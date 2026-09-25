"use client";

import { GameTable } from "./game-table.web";
import type { GameTableProps } from "./types";

/**
 * Web intentionally stays on the CanvasKit baseline. Although 0.10.2 includes
 * DOM compatibility code, its Canvas is an RN View/native-component wrapper,
 * not a stable Next DOM canvas contract for Three. Mixing that experimental
 * surface into the guaranteed baseline would add a second renderer and device.
 */
export async function canUseEnhanced(): Promise<boolean> {
  return false;
}

export function EnhancedTable(props: GameTableProps) {
  return <GameTable {...props} />;
}
