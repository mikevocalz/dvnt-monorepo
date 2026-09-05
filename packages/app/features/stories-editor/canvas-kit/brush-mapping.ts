// ============================================================
// Canvas Kit Adapter — drawing <-> brush mapping (pure)
// ============================================================
// Bridges the store's DrawingTool/DrawingPath model to the kit's
// BrushLayer tool set + flat-number-array stroke events. neon and arrow
// have NO kit brush equivalent (baseline §3 row 10 / §4 item 3) — they are
// mapped to null so the caller keeps rendering them via the existing
// DrawingPathRenderer until an upstream brush lands.
// ============================================================

import type { BrushStrokeEvent, BrushTool } from "react-native-canvas-kit";
import type { DrawingTool, DrawingPath, Position } from "../types";
import { DRAWING_TOOL_CONFIG } from "../constants";
import { generateId } from "../utils/helpers";

/** store DrawingTool -> kit BrushTool. `null` = no kit brush (keep custom). */
export const DRAWING_TOOL_TO_BRUSH_TOOL: Record<DrawingTool, BrushTool | null> =
  {
    pen: "pen",
    marker: "marker",
    highlighter: "highlighter",
    eraser: "eraser",
    neon: null, // gap — no kit neon brush (multi-pass glow); upstream-first
    arrow: null, // gap — no kit arrow brush (arrowhead terminator); upstream-first
  };

/** kit BrushTool -> store DrawingTool (pencil/tape fold onto nearest store tool). */
export const BRUSH_TOOL_TO_DRAWING_TOOL: Record<BrushTool, DrawingTool> = {
  pen: "pen",
  pencil: "pen",
  marker: "marker",
  highlighter: "highlighter",
  tape: "marker",
  eraser: "eraser",
};

/** kit flat [x,y,x,y,…] -> store Position[] (optionally display->canvas scaled). */
export function brushPointsToPositions(
  points: number[],
  scale = 1,
): Position[] {
  const out: Position[] = [];
  for (let i = 0; i + 1 < points.length; i += 2) {
    out.push({ x: points[i] / scale, y: points[i + 1] / scale });
  }
  return out;
}

/** store Position[] -> kit flat [x,y,x,y,…] (optionally canvas->display scaled). */
export function positionsToBrushPoints(
  points: Position[],
  scale = 1,
): number[] {
  const out: number[] = [];
  for (const p of points) {
    out.push(p.x * scale, p.y * scale);
  }
  return out;
}

export interface BrushStrokeToPathOptions {
  /** Stroke color (from the store's drawingColor). */
  color: string;
  /** Stroke width in canvas units (from the store's strokeWidth). */
  strokeWidth: number;
  /** display->canvas divisor (surface.scale) if the stroke arrived in
   *  display space. Defaults to 1 (already canvas space). */
  scale?: number;
}

/**
 * Convert a committed kit BrushStrokeEvent to a store DrawingPath, ready for
 * `addDrawingPath()`. Opacity is taken from the existing DRAWING_TOOL_CONFIG
 * so committed strokes match the current renderer exactly.
 */
export function brushStrokeToDrawingPath(
  stroke: BrushStrokeEvent,
  { color, strokeWidth, scale = 1 }: BrushStrokeToPathOptions,
): DrawingPath {
  const tool = BRUSH_TOOL_TO_DRAWING_TOOL[stroke.tool];
  return {
    id: generateId(),
    points: brushPointsToPositions(stroke.points, scale),
    color,
    strokeWidth,
    tool,
    opacity: DRAWING_TOOL_CONFIG[tool].opacity,
  };
}
