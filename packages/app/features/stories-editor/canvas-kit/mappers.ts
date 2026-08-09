// ============================================================
// Canvas Kit Adapter — element <-> node mapping (pure)
// ============================================================
// The Zustand editor-store is the SINGLE source of truth. These pure
// functions translate between the store's CanvasElement/Transform model
// (center-origin, uniform scale, degrees) and react-native-canvas-kit's
// Konva-style node config (top-left origin + offsetX/Y, scaleX/scaleY,
// degrees). All element<->node conversion MUST route through here so the
// coordinate model can never drift (baseline §4.4).
// ============================================================

import type {
  NodeConfig,
  NodeHandle,
  TransformResult,
} from "react-native-canvas-kit";
import type { CanvasElement, Transform } from "../types";

/** Rotation snap targets (degrees) — matches the current overlay behavior
 *  (ElementGestureOverlay snapTargets: -90/0/90/180). */
export const ROTATION_SNAPS: number[] = [-90, 0, 90, 180];

/** Snap tolerance in degrees (current overlay used a 3° window). */
export const ROTATION_SNAP_TOLERANCE = 3;

/** Element bounding size in CANVAS units (1080×1920 space). */
export interface ElementNodeSize {
  width: number;
  height: number;
}

/**
 * Map a store element + its canvas-space size to a kit NodeConfig.
 *
 * Center-origin bridge: the store's `translateX/Y` is the element CENTER.
 * Setting `offsetX = width/2`, `offsetY = height/2` moves the node's origin
 * to its own center, so placing `x = translateX` puts the center at the
 * right spot and rotation/scale pivot about the center — identical to the
 * current Skia `Group transform` behavior.
 */
export function elementToNodeConfig(
  el: CanvasElement,
  size: ElementNodeSize,
): NodeConfig {
  const { translateX, translateY, scale, rotation } = el.transform;
  return {
    id: el.id,
    x: translateX,
    y: translateY,
    width: size.width,
    height: size.height,
    offsetX: size.width / 2,
    offsetY: size.height / 2,
    scaleX: scale,
    scaleY: scale,
    rotation,
    opacity: el.opacity,
    draggable: true,
    scalable: true,
    rotatable: true,
    rotationSnaps: ROTATION_SNAPS,
    rotationSnapTolerance: ROTATION_SNAP_TOLERANCE,
  };
}

/** Kit Transformer result (x,y,scaleX,scaleY,rotation°) -> store Transform.
 *  Uniform scale: keepRatio is expected, so scaleX is authoritative. */
export function transformResultToTransform(r: TransformResult): Transform {
  return {
    translateX: r.x,
    translateY: r.y,
    scale: r.scaleX,
    rotation: r.rotation,
  };
}

/** Read a committed drag/transform off a kit NodeHandle -> store Transform. */
export function nodeHandleToTransform(h: NodeHandle): Transform {
  return {
    translateX: h.getX(),
    translateY: h.getY(),
    scale: h.getScaleX(),
    rotation: h.getRotation(),
  };
}
