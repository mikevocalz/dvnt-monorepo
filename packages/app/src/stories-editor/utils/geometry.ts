// ============================================================
// Geometry Utilities — Single source of truth for coordinate mapping
// ============================================================
//
// Canvas coordinate system: 1080 × 1920 (9:16)
// All element positions, drawing points, and transforms use canvas coords.
// The Skia Canvas view is sized to displayWidth × displayHeight and a
// root Group with transform=[{ scale: canvasScale }] maps canvas→screen.
// ============================================================

import { useMemo } from "react";
import { Dimensions, useWindowDimensions } from "react-native";
import { CANVAS_WIDTH, CANVAS_HEIGHT } from "../constants";

export interface RenderSurface {
  /** Canvas (logical) width — always CANVAS_WIDTH */
  canvasW: number;
  /** Canvas (logical) height — always CANVAS_HEIGHT */
  canvasH: number;
  /** Uniform scale factor: canvas → display pixels */
  scale: number;
  /** Display width in points (canvasW × scale) */
  displayW: number;
  /** Display height in points (canvasH × scale) */
  displayH: number;
  /** Horizontal offset of the canvas view within the screen */
  offsetX: number;
  /** Vertical offset of the canvas view within the screen */
  offsetY: number;
  /** Screen width in points */
  screenW: number;
  /** Screen height in points */
  screenH: number;
}

function buildSurface(screenW: number, screenH: number): RenderSurface {
  const scale = Math.min(screenW / CANVAS_WIDTH, screenH / CANVAS_HEIGHT);
  const displayW = CANVAS_WIDTH * scale;
  const displayH = CANVAS_HEIGHT * scale;
  return {
    canvasW: CANVAS_WIDTH,
    canvasH: CANVAS_HEIGHT,
    scale,
    displayW,
    displayH,
    offsetX: (screenW - displayW) / 2,
    offsetY: (screenH - displayH) / 2,
    screenW,
    screenH,
  };
}

/**
 * Reactive hook — recomputes on screen dimension changes (rotation, foldable).
 * Use this in components.
 */
export function useRenderSurface(): RenderSurface {
  const { width, height } = useWindowDimensions();
  return useMemo(() => buildSurface(width, height), [width, height]);
}

/**
 * @deprecated Use useRenderSurface() hook instead for reactive updates.
 * Kept for backward compat in non-component contexts.
 */
export function computeRenderSurface(): RenderSurface {
  const { width: screenW, height: screenH } = Dimensions.get("window");
  return buildSurface(screenW, screenH);
}

/**
 * Convert a screen-space touch point (relative to the GestureDetector container,
 * which is full-screen) to canvas coordinates (1080×1920).
 */
export function screenToCanvas(
  screenX: number,
  screenY: number,
  surface: RenderSurface,
): { x: number; y: number } {
  return {
    x: (screenX - surface.offsetX) / surface.scale,
    y: (screenY - surface.offsetY) / surface.scale,
  };
}

/**
 * Convert a screen-space translation delta to canvas-space delta.
 * (No offset needed — just divide by scale.)
 */
export function deltaToCanvas(
  dx: number,
  dy: number,
  scale: number,
): { dx: number; dy: number } {
  return { dx: dx / scale, dy: dy / scale };
}

/**
 * Convert canvas coordinates to screen coordinates.
 */
export function canvasToScreen(
  canvasX: number,
  canvasY: number,
  surface: RenderSurface,
): { x: number; y: number } {
  return {
    x: canvasX * surface.scale + surface.offsetX,
    y: canvasY * surface.scale + surface.offsetY,
  };
}

/**
 * Compute how a media image (with natural width/height) should be placed
 * within the canvas rect, respecting the fit mode.
 */
export function computeMediaRect(
  naturalW: number,
  naturalH: number,
  fit: "cover" | "contain" = "cover",
): { x: number; y: number; width: number; height: number } {
  const canvasAR = CANVAS_WIDTH / CANVAS_HEIGHT;
  const mediaAR = naturalW / naturalH;

  let w: number;
  let h: number;

  if (fit === "cover") {
    if (mediaAR > canvasAR) {
      // Media is wider — match height, crop sides
      h = CANVAS_HEIGHT;
      w = h * mediaAR;
    } else {
      // Media is taller — match width, crop top/bottom
      w = CANVAS_WIDTH;
      h = w / mediaAR;
    }
  } else {
    // contain
    if (mediaAR > canvasAR) {
      w = CANVAS_WIDTH;
      h = w / mediaAR;
    } else {
      h = CANVAS_HEIGHT;
      w = h * mediaAR;
    }
  }

  return {
    x: (CANVAS_WIDTH - w) / 2,
    y: (CANVAS_HEIGHT - h) / 2,
    width: w,
    height: h,
  };
}
