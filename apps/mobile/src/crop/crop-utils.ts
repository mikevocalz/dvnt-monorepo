/**
 * Image Crop Utilities
 *
 * Deterministic crop math + high-quality bitmap generation.
 * All functions are pure except generateCroppedBitmap.
 *
 * Uses the app's canonical 4:5 portrait aspect ratio from use-responsive-media.
 */

import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import { ASPECT_RATIOS } from "@/lib/hooks/use-responsive-media";
import type { MediaAsset } from "@/lib/hooks/use-media-picker";

/** Maximum output width — prevents uploading unnecessarily large images */
export const MAX_CROP_OUTPUT_WIDTH = 1440;

/** Feed post aspect ratio (4:5 portrait) — single source of truth */
export const CROP_ASPECT_RATIO = ASPECT_RATIOS.portrait; // 5 / 4

export interface CropRect {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export interface CropState {
  scale: number;
  translateX: number;
  translateY: number;
}

/**
 * Minimum scale where image fully covers the crop frame.
 */
export function calculateMinScale(
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number,
): number {
  return Math.max(frameW / imgW, frameH / imgH);
}

/**
 * Clamp pan so the image always covers the frame (no empty space).
 */
export function clampPan(
  tx: number,
  ty: number,
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number,
  scale: number,
): { x: number; y: number } {
  const dw = imgW * scale;
  const dh = imgH * scale;
  const maxX = Math.max(0, (dw - frameW) / 2);
  const maxY = Math.max(0, (dh - frameH) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, tx)),
    y: Math.min(maxY, Math.max(-maxY, ty)),
  };
}

/**
 * Map the visible crop frame back to original image pixel coordinates.
 */
export function getCropRect(
  imgW: number,
  imgH: number,
  frameW: number,
  frameH: number,
  scale: number,
  tx: number,
  ty: number,
): CropRect {
  const cropW = frameW / scale;
  const cropH = frameH / scale;
  const cx = imgW / 2 - tx / scale;
  const cy = imgH / 2 - ty / scale;
  const ox = Math.max(0, Math.round(cx - cropW / 2));
  const oy = Math.max(0, Math.round(cy - cropH / 2));
  return {
    originX: ox,
    originY: oy,
    width: Math.min(Math.round(cropW), imgW - ox),
    height: Math.min(Math.round(cropH), imgH - oy),
  };
}

/**
 * Generate a deterministic cropped bitmap.
 * - EXIF orientation handled automatically by expo-image-manipulator
 * - Crops to specified rectangle
 * - Downscales to MAX_CROP_OUTPUT_WIDTH
 * - JPEG 0.9 quality
 */
export async function generateCroppedBitmap(
  uri: string,
  rect: CropRect,
  maxWidth = MAX_CROP_OUTPUT_WIDTH,
): Promise<{ uri: string; width: number; height: number }> {
  const actions: Array<
    | {
        crop: {
          originX: number;
          originY: number;
          width: number;
          height: number;
        };
      }
    | { resize: { width: number } }
  > = [
    {
      crop: {
        originX: rect.originX,
        originY: rect.originY,
        width: rect.width,
        height: rect.height,
      },
    },
  ];
  if (rect.width > maxWidth) {
    actions.push({ resize: { width: maxWidth } });
  }
  const result = await manipulateAsync(uri, actions, {
    compress: 0.9,
    format: SaveFormat.JPEG,
  });
  return { uri: result.uri, width: result.width, height: result.height };
}

/**
 * Get image dimensions (fallback when MediaAsset doesn't have them).
 * Uses manipulateAsync with no actions so EXIF orientation is auto-applied,
 * returning the true post-rotation pixel dimensions AND a normalizedUri
 * whose pixels are guaranteed to match the returned width/height (no
 * residual EXIF orientation tag that could cause double-rotation).
 */
export async function getImageDimensions(
  uri: string,
): Promise<{ width: number; height: number; normalizedUri: string }> {
  // Use a no-op rotate(0) action instead of an empty array.
  // Some versions of expo-image-manipulator skip processing when actions=[]
  // and may preserve the original EXIF orientation tag, causing double-rotation
  // when expo-image auto-applies EXIF on display.  rotate(0) forces a full
  // pixel re-encode that strips EXIF orientation metadata.
  const result = await manipulateAsync(uri, [{ rotate: 0 }], {
    compress: 1,
    format: SaveFormat.JPEG,
  });
  return {
    width: result.width,
    height: result.height,
    normalizedUri: result.uri,
  };
}

// ── Pending crop bridge (module-level, consumed once) ───────────────
let _pendingMedia: MediaAsset[] | null = null;
let _pendingEditIndex: number | undefined;
let _pendingAspectRatio: number | undefined;
let _pendingOnComplete: ((cropped: MediaAsset[]) => void) | undefined;

export function setPendingCrop(
  media: MediaAsset[],
  editIndex?: number,
  aspectRatio?: number,
  onComplete?: (cropped: MediaAsset[]) => void,
) {
  _pendingMedia = media;
  _pendingEditIndex = editIndex;
  _pendingAspectRatio = aspectRatio;
  _pendingOnComplete = onComplete;
}

export function consumePendingCrop(): {
  media: MediaAsset[] | null;
  editIndex: number | undefined;
  aspectRatio: number | undefined;
  onComplete: ((cropped: MediaAsset[]) => void) | undefined;
} {
  const result = {
    media: _pendingMedia,
    editIndex: _pendingEditIndex,
    aspectRatio: _pendingAspectRatio,
    onComplete: _pendingOnComplete,
  };
  _pendingMedia = null;
  _pendingEditIndex = undefined;
  _pendingAspectRatio = undefined;
  _pendingOnComplete = undefined;
  return result;
}
