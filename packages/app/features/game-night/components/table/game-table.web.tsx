"use client";

import type { ComponentType } from "react";
import { View } from "react-native";
import { WithSkiaWeb } from "@shopify/react-native-skia/lib/module/web";
import type { GameTableProps } from "./types";

async function loadScene(): Promise<{ default: ComponentType<GameTableProps> }> {
  const module = await import("./game-table-scene");
  return { default: module.GameTableScene as ComponentType<GameTableProps> };
}

/** CanvasKit is fetched only when this renderer mounts. Importing the scene is
 * also deferred because Skia's web entry reads global.CanvasKit at evaluation. */
export function GameTable(props: GameTableProps) {
  return (
    <WithSkiaWeb
      opts={{ locateFile: () => "/canvaskit.wasm" }}
      getComponent={loadScene}
      componentProps={props}
      fallback={<View style={{ minHeight: 500, backgroundColor: "#120b1b", borderRadius: 32 }} />}
    />
  );
}

export type { GameTableProps } from "./types";
