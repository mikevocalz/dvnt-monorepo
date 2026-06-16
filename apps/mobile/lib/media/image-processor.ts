/**
 * Image Processing Pipeline
 * Uses expo-image-manipulator for client-side optimization
 * NO BASE64 - Binary uploads only
 */

// @ts-ignore - expo-image-manipulator may not have types
import * as ImageManipulator from "expo-image-manipulator";
import * as FileSystem from "expo-file-system/legacy";
// @ts-ignore - expo-crypto may not have types
import * as Crypto from "expo-crypto";
import { MediaConstraints, ProcessedMedia, ValidationError } from "./types";

/**
 * Process image with optimal compression
 *
 * Strategy:
 * 1. Resize to target dimensions (cost: storage)
 * 2. Convert to WebP (cost: 30-50% smaller than JPEG)
 * 3. Apply compression (balance quality vs size)
 * 4. Calculate SHA-256 hash for deduplication
 *
 * @returns ProcessedMedia with binary URI (never base64)
 */
export async function processImage(
  sourceUri: string,
  constraints: MediaConstraints,
): Promise<ProcessedMedia> {
  console.log("[ImageProcessor] Starting:", { sourceUri, constraints });

  // Step 1: Get source image info
  const fileInfo = await FileSystem.getInfoAsync(sourceUri);
  if (!fileInfo.exists) {
    throw new Error("Source image does not exist");
  }

  // Step 2: Load and get dimensions
  const asset = await ImageManipulator.manipulateAsync(sourceUri, [], {
    compress: 1,
    format: ImageManipulator.SaveFormat.PNG, // Temp format to get dimensions
  });

  // Step 3: Calculate resize dimensions (maintain aspect ratio)
  const { width: srcWidth, height: srcHeight } = asset;
  const { maxWidth, maxHeight } = constraints;

  let targetWidth = srcWidth;
  let targetHeight = srcHeight;

  if (srcWidth > maxWidth || srcHeight > maxHeight) {
    const aspectRatio = srcWidth / srcHeight;

    if (aspectRatio > 1) {
      // Landscape
      targetWidth = Math.min(srcWidth, maxWidth);
      targetHeight = Math.round(targetWidth / aspectRatio);
    } else {
      // Portrait or square
      targetHeight = Math.min(srcHeight, maxHeight);
      targetWidth = Math.round(targetHeight * aspectRatio);
    }
  }

  console.log("[ImageProcessor] Resize:", {
    original: `${srcWidth}x${srcHeight}`,
    target: `${targetWidth}x${targetHeight}`,
  });

  // Step 4: Resize + Convert to WebP
  const processed = await ImageManipulator.manipulateAsync(
    sourceUri,
    targetWidth !== srcWidth || targetHeight !== srcHeight
      ? [{ resize: { width: targetWidth, height: targetHeight } }]
      : [],
    {
      compress: constraints.compressionQuality,
      format: ImageManipulator.SaveFormat.WEBP,
    },
  );

  // Step 5: Get final file size
  const processedInfo = (await FileSystem.getInfoAsync(processed.uri)) as {
    exists: boolean;
    size?: number;
  };
  const sizeBytes = processedInfo.size || 0;

  // Step 6: Validate size constraint
  if (sizeBytes > constraints.maxSizeBytes) {
    // Retry with lower quality if too large
    const lowerQuality = Math.max(0.5, constraints.compressionQuality - 0.15);
    console.warn(
      "[ImageProcessor] Size exceeded, retrying with quality:",
      lowerQuality,
    );

    const reprocessed = await ImageManipulator.manipulateAsync(
      sourceUri,
      [{ resize: { width: targetWidth, height: targetHeight } }],
      {
        compress: lowerQuality,
        format: ImageManipulator.SaveFormat.WEBP,
      },
    );

    const reprocessedInfo = (await FileSystem.getInfoAsync(
      reprocessed.uri,
    )) as { exists: boolean; size?: number };
    const reprocessedSize = reprocessedInfo.size || 0;

    if (reprocessedSize > constraints.maxSizeBytes) {
      throw new Error(
        `Image too large: ${(reprocessedSize / 1024 / 1024).toFixed(2)}MB (max: ${(constraints.maxSizeBytes / 1024 / 1024).toFixed(2)}MB)`,
      );
    }

    processed.uri = reprocessed.uri;
    processedInfo.size = reprocessedSize;
  }

  // Step 7: Calculate SHA-256 hash for deduplication
  const hash = await Crypto.digestStringAsync(
    Crypto.CryptoDigestAlgorithm.SHA256,
    await FileSystem.readAsStringAsync(processed.uri, {
      encoding: "base64" as any,
    }),
  );

  console.log("[ImageProcessor] Complete:", {
    size: `${(sizeBytes / 1024).toFixed(2)}KB`,
    dimensions: `${processed.width}x${processed.height}`,
    hash: hash.substring(0, 16),
  });

  return {
    uri: processed.uri,
    type: "image",
    kind: "image" as const,
    mimeType: "image/webp",
    width: processed.width,
    height: processed.height,
    sizeBytes,
    hash,
  };
}

/**
 * Validate image before processing
 * Fail fast to avoid wasted processing
 */
export async function validateImage(
  sourceUri: string,
  constraints: MediaConstraints,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  try {
    const fileInfo = await FileSystem.getInfoAsync(sourceUri);

    if (!fileInfo.exists) {
      errors.push({
        field: "file",
        message: "File does not exist",
        current: 0,
        max: 0,
      });
      return errors;
    }

    // Check file size before any processing
    const size = fileInfo.size || 0;
    if (size > constraints.maxSizeBytes * 2) {
      // Allow 2x max for raw images (will be compressed)
      errors.push({
        field: "size",
        message: "Image file too large",
        current: size,
        max: constraints.maxSizeBytes * 2,
      });
    }
  } catch (error) {
    console.error("[ImageValidator] Error:", error);
    errors.push({
      field: "validation",
      message: "Failed to validate image",
      current: 0,
      max: 0,
    });
  }

  return errors;
}
