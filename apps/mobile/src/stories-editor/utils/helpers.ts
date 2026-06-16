// ============================================================
// Instagram Stories Editor - Utility Functions
// ============================================================

import { Dimensions } from "react-native";
import { Position, CanvasElement, FilterAdjustment, Transform } from "../types";
import { CANVAS_WIDTH, CANVAS_HEIGHT, IDENTITY_MATRIX } from "../constants";

const { width: SCREEN_WIDTH, height: SCREEN_HEIGHT } = Dimensions.get("window");

// ---- ID Generation ----

export const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
};

// ---- Canvas Coordinate Mapping ----

export const getCanvasScale = (): number => {
  const scaleX = SCREEN_WIDTH / CANVAS_WIDTH;
  const scaleY = SCREEN_HEIGHT / CANVAS_HEIGHT;
  return Math.min(scaleX, scaleY);
};

export const screenToCanvas = (screenPos: Position): Position => {
  const scale = getCanvasScale();
  const offsetX = (SCREEN_WIDTH - CANVAS_WIDTH * scale) / 2;
  const offsetY = (SCREEN_HEIGHT - CANVAS_HEIGHT * scale) / 2;
  return {
    x: (screenPos.x - offsetX) / scale,
    y: (screenPos.y - offsetY) / scale,
  };
};

export const canvasToScreen = (canvasPos: Position): Position => {
  const scale = getCanvasScale();
  const offsetX = (SCREEN_WIDTH - CANVAS_WIDTH * scale) / 2;
  const offsetY = (SCREEN_HEIGHT - CANVAS_HEIGHT * scale) / 2;
  return {
    x: canvasPos.x * scale + offsetX,
    y: canvasPos.y * scale + offsetY,
  };
};

// ---- Transform Helpers ----

export const defaultTransform = (): Transform => ({
  translateX: CANVAS_WIDTH / 2,
  translateY: CANVAS_HEIGHT / 2,
  scale: 1,
  rotation: 0,
});

export const hitTest = (
  point: Position,
  element: CanvasElement,
  padding: number = 20,
): boolean => {
  const { translateX, translateY, scale } = element.transform;

  // Simple bounding box hit test (ignoring rotation for perf)
  let halfWidth = 100 * scale + padding;
  let halfHeight = 50 * scale + padding;

  if (element.type === "sticker") {
    halfWidth = (element.size / 2) * scale + padding;
    halfHeight = (element.size / 2) * scale + padding;
  } else if (element.type === "text") {
    halfWidth = (element.maxWidth / 2) * scale + padding;
    halfHeight = element.fontSize * 2 * scale + padding;
  }

  return (
    point.x >= translateX - halfWidth &&
    point.x <= translateX + halfWidth &&
    point.y >= translateY - halfHeight &&
    point.y <= translateY + halfHeight
  );
};

// ---- Color Matrix Utilities ----

/**
 * Build a combined color matrix from filter adjustments
 * Returns a 4x5 matrix for Skia's ColorFilter
 */
export const buildAdjustmentMatrix = (adj: FilterAdjustment): number[] => {
  let matrix = [...IDENTITY_MATRIX];

  // Brightness: offset the RGB channels
  // Skia ColorMatrix offsets are in [0,1] range (normalized float colors)
  if (adj.brightness !== 0) {
    const b = adj.brightness / 100; // -100..100 → -1..1
    matrix = multiplyColorMatrix(matrix, [
      1,
      0,
      0,
      0,
      b,
      0,
      1,
      0,
      0,
      b,
      0,
      0,
      1,
      0,
      b,
      0,
      0,
      0,
      1,
      0,
    ]);
  }

  // Contrast
  if (adj.contrast !== 0) {
    const c = 1 + adj.contrast / 100;
    const t = -0.5 * c + 0.5; // offset in [0,1] range
    matrix = multiplyColorMatrix(matrix, [
      c,
      0,
      0,
      0,
      t,
      0,
      c,
      0,
      0,
      t,
      0,
      0,
      c,
      0,
      t,
      0,
      0,
      0,
      1,
      0,
    ]);
  }

  // Saturation
  if (adj.saturation !== 0) {
    const s = 1 + adj.saturation / 100;
    const sr = (1 - s) * 0.3086;
    const sg = (1 - s) * 0.6094;
    const sb = (1 - s) * 0.082;
    matrix = multiplyColorMatrix(matrix, [
      sr + s,
      sg,
      sb,
      0,
      0,
      sr,
      sg + s,
      sb,
      0,
      0,
      sr,
      sg,
      sb + s,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
    ]);
  }

  // Temperature (warm = +R-B, cool = -R+B)
  if (adj.temperature !== 0) {
    const t = (adj.temperature / 100) * 0.15; // subtle shift
    matrix = multiplyColorMatrix(matrix, [
      1,
      0,
      0,
      0,
      t,
      0,
      1,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      -t,
      0,
      0,
      0,
      1,
      0,
    ]);
  }

  // Tint (green-magenta shift)
  if (adj.tint !== 0) {
    const t = (adj.tint / 100) * 0.12; // subtle shift
    matrix = multiplyColorMatrix(matrix, [
      1,
      0,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      -t,
      0,
      0,
      1,
      0,
      t,
      0,
      0,
      0,
      1,
      0,
    ]);
  }

  // Fade (lift shadows)
  if (adj.fade !== 0) {
    const f = (adj.fade / 100) * 0.15; // subtle lift
    matrix = multiplyColorMatrix(matrix, [
      1,
      0,
      0,
      0,
      f,
      0,
      1,
      0,
      0,
      f,
      0,
      0,
      1,
      0,
      f,
      0,
      0,
      0,
      1,
      0,
    ]);
  }

  return matrix;
};

/**
 * Multiply two 4x5 color matrices
 */
export const multiplyColorMatrix = (a: number[], b: number[]): number[] => {
  const result: number[] = new Array(20).fill(0);
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 5; j++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) {
        sum += a[i * 5 + k] * b[k * 5 + j];
      }
      if (j === 4) {
        sum += a[i * 5 + 4];
      }
      result[i * 5 + j] = sum;
    }
  }
  return result;
};

/**
 * Interpolate between two color matrices
 */
export const interpolateMatrix = (
  a: number[],
  b: number[],
  t: number,
): number[] => {
  return a.map((val, i) => val + (b[i] - val) * t);
};

// ---- Path Smoothing for Drawing ----

export const smoothPath = (
  points: Position[],
  tension: number = 0.5,
): Position[] => {
  if (points.length < 3) return points;

  const smoothed: Position[] = [points[0]];

  for (let i = 1; i < points.length - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];

    smoothed.push({
      x: curr.x + (next.x - prev.x) * tension * 0.25,
      y: curr.y + (next.y - prev.y) * tension * 0.25,
    });
  }

  smoothed.push(points[points.length - 1]);
  return smoothed;
};

/**
 * Convert points to an SVG path string for Skia
 */
export const pointsToSvgPath = (points: Position[]): string => {
  if (points.length === 0) return "";
  if (points.length === 1) {
    return `M ${points[0].x} ${points[0].y} L ${points[0].x + 0.1} ${points[0].y + 0.1}`;
  }

  let path = `M ${points[0].x} ${points[0].y}`;

  if (points.length === 2) {
    path += ` L ${points[1].x} ${points[1].y}`;
    return path;
  }

  // Use quadratic bezier curves for smooth paths
  for (let i = 1; i < points.length - 1; i++) {
    const midX = (points[i].x + points[i + 1].x) / 2;
    const midY = (points[i].y + points[i + 1].y) / 2;
    path += ` Q ${points[i].x} ${points[i].y} ${midX} ${midY}`;
  }

  const last = points[points.length - 1];
  path += ` L ${last.x} ${last.y}`;

  return path;
};

// ---- Clamp / Math Helpers ----

export const clamp = (value: number, min: number, max: number): number =>
  Math.min(Math.max(value, min), max);

export const lerp = (a: number, b: number, t: number): number =>
  a + (b - a) * t;

export const degreesToRadians = (degrees: number): number =>
  (degrees * Math.PI) / 180;

export const radiansToDegrees = (radians: number): number =>
  (radians * 180) / Math.PI;

export const distance = (a: Position, b: Position): number =>
  Math.sqrt((b.x - a.x) ** 2 + (b.y - a.y) ** 2);

// ---- Z-Index Management ----

export const getNextZIndex = (elements: CanvasElement[]): number => {
  if (elements.length === 0) return 1;
  return Math.max(...elements.map((e) => e.zIndex)) + 1;
};

// ---- Hex / Color Utilities ----

export const hexToRgba = (hex: string, alpha: number = 1): string => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
};

export const rgbaToHex = (r: number, g: number, b: number): string => {
  return "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
};

// ---- Debounce ----
// Re-export from @tanstack/pacer — do NOT use setTimeout as a debounce mechanism.
export { debounce } from "@tanstack/pacer";

// ---- Format Duration ----

export const formatDuration = (seconds: number): string => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};
