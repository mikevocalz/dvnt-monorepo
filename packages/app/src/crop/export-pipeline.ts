/**
 * Export Pipeline — expo-image-manipulator ONLY (NO SKIA).
 *
 * Replays the non-destructive EditState as manipulator actions:
 *   1. Rotate (rotate90 + straighten combined)
 *   2. Flip horizontal (if flipX)
 *   3. Crop (rect computed in post-rotate/flip space)
 *   4. Resize (maxEdge, preserve aspect)
 *   5. Save (quality + format)
 *
 * CRITICAL: The action order MUST match what computeCropRectPixels expects.
 */

import {
  manipulateAsync,
  FlipType,
  SaveFormat,
  type Action,
} from "expo-image-manipulator";
import type { EditState } from "./edit-state";
import {
  computeCropRectPixels,
  getRotatedDimensions,
  getStraightenedDimensions,
} from "./crop-math";

export interface ExportResult {
  uri: string;
  width: number;
  height: number;
}

/**
 * Map our format string to expo-image-manipulator SaveFormat.
 */
function toSaveFormat(fmt: string): SaveFormat {
  switch (fmt) {
    case "png":
      return SaveFormat.PNG;
    case "webp":
      return SaveFormat.WEBP;
    default:
      return SaveFormat.JPEG;
  }
}

/**
 * Export the edited image. All pixel work happens here — never during gestures.
 *
 * @param state       Current EditState with all params
 * @param cropFrameW  Width of the crop frame on screen (pixels)
 * @param cropFrameH  Height of the crop frame on screen (pixels)
 * @param viewScale   Current gesture scale (from shared value)
 * @param viewTx      Current gesture translateX (from shared value)
 * @param viewTy      Current gesture translateY (from shared value)
 */
export async function exportImage(
  state: EditState,
  cropFrameW: number,
  cropFrameH: number,
  viewScale: number,
  viewTx: number,
  viewTy: number,
): Promise<ExportResult> {
  const actions: Action[] = [];

  // ── 1. Rotate ──────────────────────────────────────────────────────
  // Combine rotate90 + straighten into a single rotate action.
  const totalRotation = state.rotate90 + state.straighten;
  if (totalRotation !== 0) {
    actions.push({ rotate: totalRotation });
  }

  // ── 2. Flip ────────────────────────────────────────────────────────
  if (state.flipX) {
    actions.push({ flip: FlipType.Horizontal });
  }

  // ── 3. Crop ────────────────────────────────────────────────────────
  // Compute crop rect in the post-rotate/flip coordinate space.
  const cropRect = computeCropRectPixels({
    sourceW: state.sourceSize.w,
    sourceH: state.sourceSize.h,
    containerW: cropFrameW,
    containerH: cropFrameH,
    cropFrameW,
    cropFrameH,
    scale: viewScale,
    tx: viewTx,
    ty: viewTy,
    rotate90: state.rotate90,
    straighten: state.straighten,
    flipX: state.flipX,
  });

  // Safety clamp: expo-image-manipulator rejects crop rects outside image bounds.
  // Use the EXACT same dimension helpers as computeCropRectPixels to avoid
  // any rounding disagreement between trig and the helper functions.
  // All values MUST be positive integers — floating point causes silent failures.
  const rotated = getRotatedDimensions(
    state.sourceSize.w,
    state.sourceSize.h,
    state.rotate90,
  );
  const effective = getStraightenedDimensions(
    rotated.w,
    rotated.h,
    state.straighten,
  );
  const postW = Math.floor(effective.w);
  const postH = Math.floor(effective.h);

  // Round to integers and aggressively clamp
  let safeOriginX = Math.max(0, Math.floor(cropRect.originX));
  let safeOriginY = Math.max(0, Math.floor(cropRect.originY));
  let safeWidth = Math.max(1, Math.round(cropRect.width));
  let safeHeight = Math.max(1, Math.round(cropRect.height));

  // Guarantee origin + size <= postDimension (integer arithmetic)
  if (safeOriginX + safeWidth > postW) {
    safeWidth = Math.max(1, postW - safeOriginX);
  }
  if (safeOriginY + safeHeight > postH) {
    safeHeight = Math.max(1, postH - safeOriginY);
  }
  // If origin itself exceeds bounds, reset to full image
  if (safeOriginX >= postW || safeOriginY >= postH) {
    safeOriginX = 0;
    safeOriginY = 0;
    safeWidth = postW;
    safeHeight = postH;
  }

  // Final NaN/Infinity guard
  if (
    !Number.isFinite(safeOriginX) ||
    !Number.isFinite(safeOriginY) ||
    !Number.isFinite(safeWidth) ||
    !Number.isFinite(safeHeight)
  ) {
    safeOriginX = 0;
    safeOriginY = 0;
    safeWidth = postW;
    safeHeight = postH;
  }

  actions.push({
    crop: {
      originX: safeOriginX,
      originY: safeOriginY,
      width: safeWidth,
      height: safeHeight,
    },
  });

  // ── 4. Resize ──────────────────────────────────────────────────────
  if (state.output.maxEdge) {
    const maxEdge = state.output.maxEdge;
    // Only resize if the crop result exceeds maxEdge
    if (cropRect.width > maxEdge || cropRect.height > maxEdge) {
      if (cropRect.width >= cropRect.height) {
        actions.push({ resize: { width: maxEdge } });
      } else {
        actions.push({ resize: { height: maxEdge } });
      }
    }
  }

  // ── 5. Save ────────────────────────────────────────────────────────
  const saveOptions = {
    compress: state.output.quality,
    format: toSaveFormat(state.output.format),
  };

  try {
    const result = await manipulateAsync(state.sourceUri, actions, saveOptions);
    return { uri: result.uri, width: result.width, height: result.height };
  } catch (firstErr) {
    // ── Fallback: two-pass export ────────────────────────────────────
    // The most common cause is an EXIF orientation mismatch — the image
    // picker / Image.getSize reports raw sensor dimensions while
    // expo-image-manipulator auto-applies EXIF rotation, producing a
    // different actual size.  We normalise first, read the REAL
    // dimensions, re-clamp the crop, then crop in a second pass.
    console.warn(
      "[ExportPipeline] First pass failed, retrying with two-pass fallback:",
      firstErr,
    );

    // Pass 1 — apply rotate + flip only (no crop) to normalise the image
    const preActions: Action[] = [];
    if (totalRotation !== 0) preActions.push({ rotate: totalRotation });
    if (state.flipX) preActions.push({ flip: FlipType.Horizontal });

    const normalized = await manipulateAsync(state.sourceUri, preActions, {
      compress: 1, // lossless intermediate
      format: SaveFormat.JPEG,
    });

    // Real post-transform dimensions from the native side
    const realW = normalized.width;
    const realH = normalized.height;

    // Re-compute crop against the ACTUAL dimensions
    const fixedCrop = computeCropRectPixels({
      sourceW: realW,
      sourceH: realH,
      containerW: cropFrameW,
      containerH: cropFrameH,
      cropFrameW,
      cropFrameH,
      scale: viewScale,
      tx: viewTx,
      ty: viewTy,
      rotate90: 0, // already applied in pass 1
      straighten: 0,
      flipX: false,
    });

    // Clamp to integer pixel bounds
    let fx = Math.max(0, Math.floor(fixedCrop.originX));
    let fy = Math.max(0, Math.floor(fixedCrop.originY));
    let fw = Math.max(1, Math.round(fixedCrop.width));
    let fh = Math.max(1, Math.round(fixedCrop.height));
    if (fx + fw > realW) fw = Math.max(1, realW - fx);
    if (fy + fh > realH) fh = Math.max(1, realH - fy);
    if (fx >= realW || fy >= realH) {
      fx = 0;
      fy = 0;
      fw = realW;
      fh = realH;
    }

    // Pass 2 — crop + resize on the normalised image
    const pass2Actions: Action[] = [
      { crop: { originX: fx, originY: fy, width: fw, height: fh } },
    ];
    if (state.output.maxEdge) {
      const maxEdge = state.output.maxEdge;
      if (fw > maxEdge || fh > maxEdge) {
        if (fw >= fh) {
          pass2Actions.push({ resize: { width: maxEdge } });
        } else {
          pass2Actions.push({ resize: { height: maxEdge } });
        }
      }
    }

    const result = await manipulateAsync(
      normalized.uri,
      pass2Actions,
      saveOptions,
    );
    return { uri: result.uri, width: result.width, height: result.height };
  }
}
