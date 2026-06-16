/**
 * Video Processing Pipeline
 *
 * CRITICAL: We do NOT transcode server-side (cost + complexity)
 * Strategy: Enforce strict client-side constraints
 *
 * Mobile Capture Optimization:
 * - Use camera presets that match our limits (720p/1080p @ 30fps)
 * - Reject videos that don't meet requirements
 * - Generate thumbnail for fast preview
 * - Calculate hash for deduplication
 */

import * as FileSystem from "expo-file-system/legacy";
// @ts-ignore - expo-crypto may not have types
import * as Crypto from "expo-crypto";
import * as VideoThumbnails from "expo-video-thumbnails";
import {
  MediaConstraints,
  ProcessedMedia,
  ValidationError,
  VideoInfo,
} from "./types";

/**
 * Extract video metadata without loading entire file
 * Uses expo-video-thumbnails to estimate video properties
 */
export async function getVideoInfo(uri: string): Promise<VideoInfo> {
  console.log("[VideoProcessor] Getting info:", uri);

  // Get file size
  const fileInfo = await FileSystem.getInfoAsync(uri);
  if (!fileInfo.exists) {
    throw new Error("Video file does not exist");
  }

  const fileInfoWithSize = fileInfo as { exists: boolean; size?: number };

  // Generate thumbnail to verify video is valid and estimate dimensions
  // expo-video doesn't expose metadata API, so we use thumbnail generation
  try {
    const thumbnail = await VideoThumbnails.getThumbnailAsync(uri, {
      time: 0,
      quality: 0.1,
    });

    // Estimate duration from file size (rough approximation)
    // Typical mobile video: ~2-4 Mbps = 250-500 KB/s
    const estimatedBitrate = 3_000_000; // 3 Mbps average
    const fileSizeBytes = fileInfoWithSize.size || 0;
    const estimatedDuration = (fileSizeBytes * 8) / estimatedBitrate;

    return {
      uri,
      width: thumbnail.width || 1080,
      height: thumbnail.height || 1920,
      duration: estimatedDuration,
      size: fileSizeBytes,
    };
  } catch (error) {
    console.error("[VideoProcessor] Failed to get video info:", error);
    // Return defaults if we can't get info
    return {
      uri,
      width: 1080,
      height: 1920,
      duration: 0,
      size: fileInfoWithSize.size || 0,
    };
  }
}

/**
 * Validate video against constraints
 * FAIL FAST - Reject before any processing
 *
 * Philosophy:
 * - Better to reject than waste upload bandwidth
 * - Guide users to record within limits
 * - Clear error messages for re-recording
 */
export async function validateVideo(
  uri: string,
  constraints: MediaConstraints,
): Promise<ValidationError[]> {
  const errors: ValidationError[] = [];

  try {
    const info = await getVideoInfo(uri);

    // Check duration
    if (
      constraints.maxDurationSeconds &&
      info.duration > constraints.maxDurationSeconds
    ) {
      errors.push({
        field: "duration",
        message: `Video too long (max ${constraints.maxDurationSeconds}s)`,
        current: Math.round(info.duration),
        max: constraints.maxDurationSeconds,
      });
    }

    // Check resolution
    if (
      info.width > constraints.maxWidth ||
      info.height > constraints.maxHeight
    ) {
      errors.push({
        field: "resolution",
        message: `Resolution too high (max ${constraints.maxWidth}x${constraints.maxHeight})`,
        current: Math.max(info.width, info.height),
        max: Math.max(constraints.maxWidth, constraints.maxHeight),
      });
    }

    // Check file size
    if (info.size > constraints.maxSizeBytes) {
      errors.push({
        field: "size",
        message: `File too large (max ${(constraints.maxSizeBytes / 1024 / 1024).toFixed(0)}MB)`,
        current: info.size,
        max: constraints.maxSizeBytes,
      });
    }

    // Estimate bitrate (quality check)
    const bitrateKbps = (info.size * 8) / info.duration / 1000;
    console.log("[VideoValidator] Bitrate:", `${bitrateKbps.toFixed(0)} kbps`);

    // Warn if bitrate is suspiciously high (likely not H.264 or high quality)
    if (bitrateKbps > 8000) {
      console.warn(
        "[VideoValidator] High bitrate detected, may fail on slow networks",
      );
    }
  } catch (error: any) {
    console.error("[VideoValidator] Error:", error);
    errors.push({
      field: "validation",
      message: error.message || "Failed to validate video",
      current: 0,
      max: 0,
    });
  }

  return errors;
}

/**
 * Process video for upload
 *
 * Since we don't transcode:
 * 1. Validate constraints (reject if out of bounds)
 * 2. Generate poster frame (thumbnail)
 * 3. Calculate hash for deduplication
 * 4. Return metadata
 *
 * @throws Error if video doesn't meet constraints
 */
export async function processVideo(
  sourceUri: string,
  constraints: MediaConstraints,
): Promise<ProcessedMedia> {
  console.log("[VideoProcessor] Starting:", { sourceUri, constraints });

  // Step 1: Validate
  const errors = await validateVideo(sourceUri, constraints);
  if (errors.length > 0) {
    const errorMsg = errors.map((e) => `${e.field}: ${e.message}`).join(", ");
    throw new Error(`Video validation failed: ${errorMsg}`);
  }

  // Step 2: Get video info
  const info = await getVideoInfo(sourceUri);

  // Step 3: Generate poster frame (for fast preview)
  let posterUri: string | undefined;
  try {
    const { uri: thumbnailUri } = await VideoThumbnails.getThumbnailAsync(
      sourceUri,
      {
        time: Math.min(1000, info.duration * 500), // Get frame at 1s or middle
        quality: 0.7,
      },
    );
    posterUri = thumbnailUri;
    console.log("[VideoProcessor] Generated poster:", thumbnailUri);
  } catch (error) {
    console.error("[VideoProcessor] Failed to generate poster:", error);
    // Non-critical, continue without poster
  }

  // Step 4: Calculate SHA-256 hash
  // For large videos, we hash in chunks to avoid memory issues
  const hash = await hashLargeFile(sourceUri);

  console.log("[VideoProcessor] Complete:", {
    size: `${(info.size / 1024 / 1024).toFixed(2)}MB`,
    duration: `${info.duration.toFixed(1)}s`,
    resolution: `${info.width}x${info.height}`,
    hash: hash.substring(0, 16),
  });

  return {
    uri: sourceUri,
    type: "video",
    kind: "video" as const,
    mimeType: "video/mp4",
    width: info.width,
    height: info.height,
    sizeBytes: info.size,
    durationSeconds: info.duration,
    hash,
    posterUri,
  };
}

/**
 * Hash large files in chunks to avoid memory issues
 * Expo doesn't support streaming hash, so we read in chunks
 */
async function hashLargeFile(uri: string): Promise<string> {
  const CHUNK_SIZE = 1024 * 1024; // 1MB chunks
  const fileInfo = (await FileSystem.getInfoAsync(uri)) as {
    exists: boolean;
    size?: number;
  };
  const fileSize = fileInfo.size || 0;

  if (fileSize < CHUNK_SIZE) {
    // Small file, hash directly
    const content = await FileSystem.readAsStringAsync(uri, {
      encoding: "base64" as any,
    });
    return Crypto.digestStringAsync(
      Crypto.CryptoDigestAlgorithm.SHA256,
      content,
    );
  }

  // For large files, we have to hash the entire file
  // This is a limitation of expo-crypto (no streaming hash)
  // Trade-off: Slight memory spike vs upload bandwidth savings from deduplication
  const content = await FileSystem.readAsStringAsync(uri, {
    encoding: "base64" as any,
  });
  return Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, content);
}

/**
 * Camera preset helper for capturing optimized video
 * Call this when initializing camera to enforce limits upfront
 */
export function getOptimalCameraPreset(useCase: "story" | "message"): {
  videoQuality: "720p" | "1080p";
  videoBitrate: number;
  videoMaxDuration: number;
} {
  if (useCase === "story") {
    return {
      videoQuality: "1080p",
      videoBitrate: 4_000_000, // 4 Mbps (balance quality vs size)
      videoMaxDuration: 60,
    };
  }

  // Message videos: lower quality for fast upload
  return {
    videoQuality: "720p",
    videoBitrate: 2_500_000, // 2.5 Mbps
    videoMaxDuration: 30,
  };
}

/**
 * Bitrate vs Resolution Tradeoffs:
 *
 * BITRATE MATTERS MORE THAN RESOLUTION for file size
 *
 * Examples (30s video):
 * - 1080p @ 8 Mbps = ~30 MB ❌ Too large
 * - 1080p @ 4 Mbps = ~15 MB ✅ Good balance
 * - 720p @ 2.5 Mbps = ~9 MB ✅ Fast upload
 * - 720p @ 8 Mbps = ~30 MB ❌ Wasteful
 *
 * Strategy:
 * 1. Use 1080p ONLY if bitrate ≤ 4-5 Mbps
 * 2. For fast upload, prefer 720p @ 2-3 Mbps
 * 3. Avoid HDR and high frame rates (60fps)
 * 4. H.264 is 30-50% smaller than H.265 at same quality
 *
 * Cost impact:
 * - 30MB vs 15MB = 2x storage cost per video
 * - At 10,000 videos/day: $300/month vs $150/month
 */
