import { createElement, useEffect, useState, type ComponentType } from "react";
import type { GameTableProps } from "./types";

type RendererModule = {
  GameTable?: ComponentType<GameTableProps>;
  EnhancedTable?: ComponentType<GameTableProps>;
  canUseEnhanced?: () => Promise<boolean>;
};

// Metro and Next resolve these to their .native/.web implementations.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const baseline = require("./game-table") as RendererModule;
// eslint-disable-next-line @typescript-eslint/no-var-requires
const enhancement = require("./enhanced-table") as RendererModule;

export const GameTable = baseline.GameTable as ComponentType<GameTableProps>;
export const EnhancedTable = enhancement.EnhancedTable as ComponentType<GameTableProps>;
export const canUseEnhanced = enhancement.canUseEnhanced as () => Promise<boolean>;

/** Presentational switch only. Game state remains in the screen, so a renderer
 * downgrade cannot reset a round or discard a selection. */
export function TableRenderer(props: GameTableProps) {
  const [enhanced, setEnhanced] = useState(false);

  useEffect(() => {
    let mounted = true;
    void canUseEnhanced().then((available: boolean) => {
      if (mounted) setEnhanced(available);
    });
    return () => {
      mounted = false;
    };
  }, []);

  return createElement(enhanced ? EnhancedTable : GameTable, props);
}

export type { GameTableProps } from "./types";
