/**
 * Crop Math — compute crop rectangle in SOURCE PIXELS.
 *
 * This is the most critical module: it translates the visual preview state
 * (pinch/pan/zoom + rotate + straighten + flip) into a pixel-accurate
 * crop rectangle in the coordinate system that expo-image-manipulator
 * will operate on AFTER rotate and flip have been applied.
 *
 * Export order (must match):
 *   1. rotate (rotate90 + straighten) via manipulator rotate action
 *   2. flip horizontal via manipulator flip action
 *   3. crop using rect computed HERE (in post-rotate/flip space)
 *   4. resize/compress/format
 *
 * Because crop happens AFTER rotate+flip, we compute the rect relative
 * to the rotated+flipped image dimensions.
 */

import type { Rotate90 } from "./edit-state";

export interface CropRectPixels {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface CropMathInput {
  /** Original source image dimensions */
  sourceW: number;
  sourceH: number;
  /** On-screen container dimensions (the area containing the crop frame) */
  containerW: number;
  containerH: number;
  /** Crop frame dimensions on screen (may differ from container for free aspect) */
  cropFrameW: number;
  cropFrameH: number;
  /** Current view transform from pinch/pan */
  scale: number;
  tx: number;
  ty: number;
  /** Rotation in 90° steps */
  rotate90: Rotate90;
  /** Fine-tune straighten in degrees (-45..45) */
  straighten: number;
  /** Horizontal flip */
  flipX: boolean;
}

/**
 * Dimensions of the source image AFTER rotate90 is applied.
 * (Straighten doesn't change the bounding box for crop purposes —
 * expo-image-manipulator rotates and expands the canvas.)
 */
export function getRotatedDimensions(
  w: number,
  h: number,
  rotate90: Rotate90,
): { w: number; h: number } {
  if (rotate90 === 90 || rotate90 === 270) {
    return { w: h, h: w };
  }
  return { w, h };
}

/**
 * When straightening by `degrees`, the image canvas expands.
 * This computes the new bounding-box dimensions.
 */
export function getStraightenedDimensions(
  w: number,
  h: number,
  degrees: number,
): { w: number; h: number } {
  if (degrees === 0) return { w, h };
  const rad = Math.abs(degrees) * (Math.PI / 180);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    w: Math.ceil(w * cos + h * sin),
    h: Math.ceil(h * cos + w * sin),
  };
}

/**
 * Compute the "base" display dimensions — how big the image would be
 * drawn on screen at scale=1 to fill the crop frame (cover fit).
 *
 * After rotate90, the effective source dimensions change.
 * After straighten, the bounding box expands further.
 * We fit this expanded image to COVER the crop frame.
 */
export function getBaseDisplaySize(
  sourceW: number,
  sourceH: number,
  cropFrameW: number,
  cropFrameH: number,
  rotate90: Rotate90,
  straighten: number,
): { baseW: number; baseH: number; minScale: number } {
  // Effective source after rotate
  const rotated = getRotatedDimensions(sourceW, sourceH, rotate90);
  // Effective source after straighten
  const effective = getStraightenedDimensions(rotated.w, rotated.h, straighten);

  // Cover fit: image must fill the frame
  const minScale = Math.max(cropFrameW / effective.w, cropFrameH / effective.h);

  return {
    baseW: effective.w,
    baseH: effective.h,
    minScale,
  };
}

/**
 * Compute the crop rectangle in post-rotate/flip pixel coordinates.
 *
 * The crop frame is centered on screen. The image is displayed at
 * `baseW * scale` × `baseH * scale`, offset by (tx, ty) from center.
 * We invert this to find what part of the post-transform image
 * is visible through the crop frame.
 */
export function computeCropRectPixels(input: CropMathInput): CropRectPixels {
  const {
    sourceW,
    sourceH,
    cropFrameW,
    cropFrameH,
    scale,
    tx,
    ty,
    rotate90,
    straighten,
  } = input;

  // Effective dimensions after rotate + straighten
  const rotated = getRotatedDimensions(sourceW, sourceH, rotate90);
  const effective = getStraightenedDimensions(rotated.w, rotated.h, straighten);

  // The crop frame sees a portion of the effective image.
  // At scale=S, the effective image is drawn as (effective.w * S, effective.h * S).
  // The crop frame is centered, so the visible region in effective-pixel coords:
  //   center of effective image + offset from pan
  const cropW = cropFrameW / scale;
  const cropH = cropFrameH / scale;

  // Center of the effective image, adjusted by pan
  // tx > 0 means image moved right → crop region moves LEFT in image coords
  const cx = effective.w / 2 - tx / scale;
  const cy = effective.h / 2 - ty / scale;

  let ox = Math.round(cx - cropW / 2);
  let oy = Math.round(cy - cropH / 2);

  let roundedCropW = Math.round(cropW);
  let roundedCropH = Math.round(cropH);

  // Clamp crop dimensions to never exceed source
  roundedCropW = Math.min(roundedCropW, effective.w);
  roundedCropH = Math.min(roundedCropH, effective.h);

  // Clamp origin so rect stays inside image bounds
  ox = Math.max(0, Math.min(ox, effective.w - roundedCropW));
  oy = Math.max(0, Math.min(oy, effective.h - roundedCropH));

  // Final safety: ensure originX + width <= effective.w (and same for Y)
  const finalW = Math.min(roundedCropW, effective.w - ox);
  const finalH = Math.min(roundedCropH, effective.h - oy);

  return {
    originX: ox,
    originY: oy,
    width: Math.max(1, finalW),
    height: Math.max(1, finalH),
  };
}

/**
 * Clamp pan so the image always covers the crop frame.
 * Used in gesture handlers to prevent blank gaps.
 */
export function clampPanForEdit(
  tx: number,
  ty: number,
  effectiveW: number,
  effectiveH: number,
  cropFrameW: number,
  cropFrameH: number,
  scale: number,
): { tx: number; ty: number } {
  const dw = effectiveW * scale;
  const dh = effectiveH * scale;
  const maxTx = Math.max(0, (dw - cropFrameW) / 2);
  const maxTy = Math.max(0, (dh - cropFrameH) / 2);
  return {
    tx: Math.min(maxTx, Math.max(-maxTx, tx)),
    ty: Math.min(maxTy, Math.max(-maxTy, ty)),
  };
}
