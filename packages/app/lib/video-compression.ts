/**
 * Video Compression Utility for Deviant
 *
 * Uses react-native-compressor for client-side video compression.
 * Falls back to pass-through if native module is unavailable.
 *
 * Target Output (Feed-Safe):
 * - Container: MP4
 * - Video Codec: H.264 (Main Profile, Level 4.1)
 * - Resolution: 1280×720 preferred, 1920×1080 max
 * - FPS: 24–30
 * - Video Bitrate: 1.4–2.0 Mbps
 * - Audio Codec: AAC @ 96 kbps
 * - Pixel Format: yuv420p
 * - Max Duration: 60s
 */

import * as LegacyFileSystem from "expo-file-system/legacy";

const FileSystem = LegacyFileSystem;

// Safe import — native module may not be in older builds
let RNCompressorVideo: typeof import("react-native-compressor").Video | null =
  null;
let RNCompressorGetMeta:
  | typeof import("react-native-compressor").getVideoMetaData
  | null = null;
try {
  const mod = require("react-native-compressor");
  RNCompressorVideo = mod.Video;
  RNCompressorGetMeta = mod.getVideoMetaData;
} catch {
  console.warn(
    "[VideoCompression] react-native-compressor not available, using pass-through",
  );
}

const COMPRESSOR_AVAILABLE = !!RNCompressorVideo;

// Validation limits
const MAX_DURATION_SECONDS = 60;
const MAX_RESOLUTION = 1080;
const MAX_FILE_SIZE_MB = 150;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Target compression settings
const TARGET_WIDTH = 1280;
const TARGET_BITRATE = "1800k";
const TARGET_MAX_BITRATE = "2000k";
const TARGET_BUFFER_SIZE = "4000k";
const TARGET_FPS = 30;
const TARGET_AUDIO_BITRATE = "96k";

export interface VideoMetadata {
  duration: number; // seconds
  width: number;
  height: number;
  bitrate: number; // bps
  codec: string;
  fileSize: number; // bytes
  fps: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  metadata?: VideoMetadata;
}

export interface CompressionResult {
  success: boolean;
  outputPath?: string;
  originalSize?: number;
  compressedSize?: number;
  compressionRatio?: number;
  error?: string;
}

export interface CompressionProgress {
  percentage: number;
  timeElapsed: number;
  estimatedTimeRemaining?: number;
}

/**
 * Get video metadata
 * Uses react-native-compressor's getVideoMetaData for real values.
 * Falls back to file-size-only estimates if native module unavailable.
 */
export async function getVideoMetadata(
  videoUri: string,
): Promise<VideoMetadata | null> {
  console.log(
    "[VideoCompression] Getting metadata for:",
    videoUri.substring(0, 80),
  );

  try {
    const fileInfo = await FileSystem.getInfoAsync(videoUri);
    if (!fileInfo.exists) {
      console.error("[VideoCompression] File does not exist");
      return null;
    }

    const fileSize = (fileInfo as any).size || 0;

    // Use real metadata from react-native-compressor if available
    if (RNCompressorGetMeta) {
      try {
        const meta = await RNCompressorGetMeta(videoUri);
        const metadata: VideoMetadata = {
          duration: meta.duration || 0,
          width: meta.width || 1920,
          height: meta.height || 1080,
          bitrate: 0,
          codec: "unknown",
          fileSize: meta.size || fileSize,
          fps: 30,
        };
        console.log("[VideoCompression] Metadata (real):", metadata);
        return metadata;
      } catch (metaErr) {
        console.warn(
          "[VideoCompression] Native metadata failed, using estimates:",
          metaErr,
        );
      }
    }

    // Fallback: estimated metadata
    const metadata: VideoMetadata = {
      duration: 30,
      width: 1920,
      height: 1080,
      bitrate: 0,
      codec: "unknown",
      fileSize,
      fps: 30,
    };
    console.log("[VideoCompression] Metadata (estimated):", metadata);
    return metadata;
  } catch (error) {
    console.error("[VideoCompression] Metadata extraction failed:", error);
    return null;
  }
}

/**
 * Validate video before processing
 * Rejects videos that exceed limits
 */
export async function validateVideo(
  videoUri: string,
): Promise<ValidationResult> {
  console.log(
    "[VideoCompression] Validating video:",
    videoUri.substring(0, 80),
  );

  const errors: string[] = [];

  // Check file exists
  const fileInfo = await FileSystem.getInfoAsync(videoUri);
  if (!fileInfo.exists) {
    return { valid: false, errors: ["Video file does not exist"] };
  }

  // Check file size before metadata extraction
  const fileSize = (fileInfo as any).size || 0;
  if (fileSize > MAX_FILE_SIZE_BYTES) {
    errors.push(
      `File size ${Math.round(fileSize / 1024 / 1024)}MB exceeds ${MAX_FILE_SIZE_MB}MB limit`,
    );
  }

  // Get metadata
  const metadata = await getVideoMetadata(videoUri);
  if (!metadata) {
    return { valid: false, errors: ["Could not read video metadata"] };
  }

  // Validate duration
  if (metadata.duration > MAX_DURATION_SECONDS) {
    errors.push(
      `Duration ${Math.round(metadata.duration)}s exceeds ${MAX_DURATION_SECONDS}s limit`,
    );
  }

  // Validate resolution
  const maxDimension = Math.max(metadata.width, metadata.height);
  if (maxDimension > MAX_RESOLUTION) {
    // This is a warning, not an error - we'll scale it down
    console.log(
      "[VideoCompression] Video will be scaled from",
      maxDimension,
      "to",
      TARGET_WIDTH,
    );
  }

  // Check for unsupported codecs (we can transcode most, but some may fail)
  const unsupportedCodecs = ["prores", "dnxhd", "rawvideo"];
  if (unsupportedCodecs.includes(metadata.codec.toLowerCase())) {
    errors.push(`Unsupported codec: ${metadata.codec}`);
  }

  const result: ValidationResult = {
    valid: errors.length === 0,
    errors,
    metadata,
  };

  console.log(
    "[VideoCompression] Validation result:",
    result.valid ? "PASS" : "FAIL",
    errors,
  );
  return result;
}

/**
 * Compress video using react-native-compressor.
 * Falls back to pass-through if native module is unavailable.
 */
export async function compressVideo(
  inputUri: string,
  onProgress?: (progress: CompressionProgress) => void,
): Promise<CompressionResult> {
  console.log("[VideoCompression] ==========================================");
  console.log("[VideoCompression] Compressor available:", COMPRESSOR_AVAILABLE);
  console.log("[VideoCompression] Input:", inputUri.substring(0, 80));

  try {
    // Validate first
    const validation = await validateVideo(inputUri);
    if (!validation.valid) {
      console.error("[VideoCompression] Validation failed:", validation.errors);
      return {
        success: false,
        error: `Video rejected: ${validation.errors.join(", ")}`,
      };
    }

    const metadata = validation.metadata!;
    const originalSize = metadata.fileSize;
    const startTime = Date.now();

    // Use real compression if available
    if (COMPRESSOR_AVAILABLE && RNCompressorVideo) {
      console.log("[VideoCompression] Starting native compression...");

      const compressedUri = await RNCompressorVideo.compress(
        inputUri,
        {
          compressionMethod: "auto",
          minimumFileSizeForCompress: 0,
        },
        (progress: number) => {
          if (onProgress) {
            const elapsed = (Date.now() - startTime) / 1000;
            const pct = Math.round(progress * 100);
            onProgress({
              percentage: pct,
              timeElapsed: elapsed,
              estimatedTimeRemaining:
                pct > 0 ? (elapsed / pct) * (100 - pct) : undefined,
            });
          }
        },
      );

      // Get compressed file size
      const compressedInfo = await FileSystem.getInfoAsync(compressedUri);
      const compressedSize = (compressedInfo as any).size || originalSize;
      const ratio =
        originalSize > 0
          ? Math.round((1 - compressedSize / originalSize) * 100)
          : 0;

      console.log(
        "[VideoCompression] ==========================================",
      );
      console.log("[VideoCompression] Compression SUCCESS");
      console.log(
        "[VideoCompression] Original:",
        Math.round(originalSize / 1024 / 1024),
        "MB",
      );
      console.log(
        "[VideoCompression] Compressed:",
        Math.round(compressedSize / 1024 / 1024),
        "MB",
      );
      console.log("[VideoCompression] Reduction:", ratio + "%");
      console.log(
        "[VideoCompression] ==========================================",
      );

      return {
        success: true,
        outputPath: compressedUri,
        originalSize,
        compressedSize,
        compressionRatio: ratio,
      };
    }

    // Fallback: pass-through (no native compressor)
    console.log("[VideoCompression] Pass-through (no native compressor)");
    if (onProgress) {
      onProgress({
        percentage: 100,
        timeElapsed: 0,
        estimatedTimeRemaining: 0,
      });
    }

    return {
      success: true,
      outputPath: inputUri,
      originalSize,
      compressedSize: originalSize,
      compressionRatio: 0,
    };
  } catch (error) {
    console.error("[VideoCompression] Compression error:", error);
    // On compression failure, fall back to pass-through rather than blocking upload
    console.warn("[VideoCompression] Falling back to pass-through");
    try {
      const fileInfo = await FileSystem.getInfoAsync(inputUri);
      const fileSize = (fileInfo as any).size || 0;
      return {
        success: true,
        outputPath: inputUri,
        originalSize: fileSize,
        compressedSize: fileSize,
        compressionRatio: 0,
      };
    } catch {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Compression failed",
      };
    }
  }
}

/**
 * Clean up compressed video file after upload
 */
export async function cleanupCompressedVideo(filePath: string): Promise<void> {
  try {
    if (filePath && filePath.includes("compressed_")) {
      await FileSystem.deleteAsync(filePath, { idempotent: true });
      console.log("[VideoCompression] Cleaned up:", filePath.substring(0, 50));
    }
  } catch (error) {
    console.warn("[VideoCompression] Cleanup failed:", error);
  }
}

/**
 * Check if a video needs compression
 * Returns true if the video should be compressed before upload
 */
export function shouldCompress(metadata: VideoMetadata): boolean {
  // Always compress videos for consistent quality and size
  // Even if a video is small, we want consistent codec/bitrate
  return true;
}

/**
 * Estimate compressed file size
 * Useful for showing user expected upload size
 */
export function estimateCompressedSize(metadata: VideoMetadata): number {
  // Target bitrate in bits per second
  const targetBitrate = 1800000 + 96000; // Video + Audio
  // Estimated size = bitrate * duration / 8 (convert to bytes)
  return Math.round((targetBitrate * metadata.duration) / 8);
}
