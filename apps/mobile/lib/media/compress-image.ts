/**
 * Image Compression Helper
 * 
 * Uses expo-image-manipulator to compress images before upload.
 * Preserves aspect ratio and orientation, never crops.
 */

import * as ImageManipulator from "expo-image-manipulator";

export interface ImageCompressionOptions {
  maxLongEdge?: number;
  quality?: number;
}

export interface CompressedImage {
  uri: string;
  width: number;
  height: number;
  mimeType: "image/jpeg" | "image/png" | "image/webp";
}

const DEFAULT_MAX_LONG_EDGE = 1440;
const DEFAULT_QUALITY = 0.82;
const STORY_MAX_LONG_EDGE = 1440;

/**
 * Compress an image for upload
 * 
 * @param uri - Local file URI
 * @param options - Compression options
 * @returns Compressed image with new URI and dimensions
 */
export async function compressImage(
  uri: string,
  options: ImageCompressionOptions = {}
): Promise<CompressedImage> {
  const { maxLongEdge = DEFAULT_MAX_LONG_EDGE, quality = DEFAULT_QUALITY } = options;

  console.log("[compressImage] Starting compression:", { uri: uri.substring(0, 50), maxLongEdge, quality });

  // First, get the original dimensions
  const originalResult = await ImageManipulator.manipulateAsync(uri, [], {
    format: ImageManipulator.SaveFormat.JPEG,
  });

  const originalWidth = originalResult.width;
  const originalHeight = originalResult.height;
  const longEdge = Math.max(originalWidth, originalHeight);

  console.log("[compressImage] Original dimensions:", { width: originalWidth, height: originalHeight, longEdge });

  // Calculate resize dimensions if needed
  const actions: ImageManipulator.Action[] = [];

  if (longEdge > maxLongEdge) {
    const scale = maxLongEdge / longEdge;
    const newWidth = Math.round(originalWidth * scale);
    const newHeight = Math.round(originalHeight * scale);

    console.log("[compressImage] Resizing to:", { width: newWidth, height: newHeight });

    actions.push({
      resize: {
        width: newWidth,
        height: newHeight,
      },
    });
  }

  // Apply compression
  const result = await ImageManipulator.manipulateAsync(uri, actions, {
    compress: quality,
    format: ImageManipulator.SaveFormat.JPEG,
  });

  console.log("[compressImage] Compressed:", {
    uri: result.uri.substring(0, 50),
    width: result.width,
    height: result.height,
  });

  return {
    uri: result.uri,
    width: result.width,
    height: result.height,
    mimeType: "image/jpeg",
  };
}

/**
 * Compress an avatar image (smaller max size)
 */
export async function compressAvatar(uri: string): Promise<CompressedImage> {
  return compressImage(uri, {
    maxLongEdge: 800,
    quality: 0.85,
  });
}

/**
 * Compress a story image (optimized for vertical display)
 */
export async function compressStoryImage(uri: string): Promise<CompressedImage> {
  return compressImage(uri, {
    maxLongEdge: STORY_MAX_LONG_EDGE,
    quality: 0.88,
  });
}

/**
 * Compress a post image
 */
export async function compressPostImage(uri: string): Promise<CompressedImage> {
  return compressImage(uri, {
    maxLongEdge: DEFAULT_MAX_LONG_EDGE,
    quality: DEFAULT_QUALITY,
  });
}

/**
 * Compress an event cover image
 */
export async function compressEventCover(uri: string): Promise<CompressedImage> {
  return compressImage(uri, {
    maxLongEdge: 1600,
    quality: 0.85,
  });
}

/**
 * Compress a message image
 */
export async function compressMessageImage(uri: string): Promise<CompressedImage> {
  return compressImage(uri, {
    maxLongEdge: 1200,
    quality: 0.78,
  });
}
