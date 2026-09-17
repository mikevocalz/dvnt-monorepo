/**
 * Video on its way out of the app.
 *
 * The default is `original`: the member's file is validated and uploaded as-is.
 * Nothing is resized, re-encoded, re-contained, converted from HEVC, flattened
 * from HDR, or reframed. `smaller` is the one mode that runs an encoder, only
 * when a caller asks for it, and it states its own dimensions and bitrate.
 *
 * The header this replaces described a "feed-safe target" of 1280x720 at
 * 1.4-2.0 Mbps. None of it was ever passed to the encoder — the call was a bare
 * `compressionMethod: "auto"`, which in react-native-compressor@1.16.0 means a
 * 640px LONGER EDGE. Every post, story and event video published from a phone
 * was stored at 360x640, and the source was deleted after upload.
 */

import * as LegacyFileSystem from "expo-file-system/legacy";
import { withUploadTimeout } from "@dvnt/app/lib/media/upload-policy";
import {
  isUsablePreparedCopy,
  planVideoUpload,
  type VideoPlan,
} from "@dvnt/app/lib/media/video-quality";

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
const MAX_FILE_SIZE_MB = 150;
const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;


/**
 * `null` means "not measured" — never a stand-in default. Callers must decide
 * what to do with an unknown rather than being handed a plausible-looking
 * number. Unknown must never trigger a destructive conversion.
 */
export interface VideoMetadata {
  duration: number | null; // seconds
  width: number | null;
  height: number | null;
  bitrate: number | null; // bps
  codec: string | null;
  fileSize: number; // bytes — from the filesystem, always known
  fps: number | null;
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
  /**
   * Did an encoder touch these bytes? Callers use this to decide whether the
   * upload is the member's original file or a copy we made — the MIME type and
   * the stored provenance both depend on the answer.
   */
  reencoded?: boolean;
  /** Measured source dimensions, or null when they could not be read. */
  width?: number | null;
  height?: number | null;
  /** What was decided and why — carried so callers can explain themselves. */
  plan?: import("@dvnt/app/lib/media/video-quality").VideoPlan;
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

    // Measured, or null. This used to answer 1920x1080 @ 30fps / 30s whenever
    // the native call was unavailable or a field was missing, and log it as
    // "real" — so an unmeasurable 4K 90-second clip read as a compliant 1080p
    // half-minute and sailed through the duration gate. A guess that is
    // indistinguishable from a measurement is worse than no answer.
    if (RNCompressorGetMeta) {
      try {
        const meta = await RNCompressorGetMeta(videoUri);
        const metadata: VideoMetadata = {
          duration: typeof meta.duration === "number" ? meta.duration : null,
          width: typeof meta.width === "number" ? meta.width : null,
          height: typeof meta.height === "number" ? meta.height : null,
          // The library reports neither, so neither is claimed.
          bitrate: null,
          codec: null,
          fileSize: meta.size || fileSize,
          fps: null,
        };
        console.log("[VideoCompression] Metadata (measured):", metadata);
        return metadata;
      } catch (metaErr) {
        console.warn(
          "[VideoCompression] Native metadata unavailable:",
          metaErr,
        );
      }
    }

    // Size is the one thing the filesystem actually knows.
    const metadata: VideoMetadata = {
      duration: null,
      width: null,
      height: null,
      bitrate: null,
      codec: null,
      fileSize,
      fps: null,
    };
    console.log("[VideoCompression] Metadata (size only):", metadata);
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

  // Duration: only judged when it was measured. An unmeasured duration is not
  // a pass and not a failure — the server checks it again with its own read.
  if (metadata.duration != null && metadata.duration > MAX_DURATION_SECONDS) {
    errors.push(
      `Duration ${Math.round(metadata.duration)}s exceeds ${MAX_DURATION_SECONDS}s limit`,
    );
  }

  // Resolution is NOT a validation failure and no longer implies a downscale.
  // A 4K source is a 4K source; it is published at 4K.
  if (metadata.width != null && metadata.height != null) {
    console.log(
      "[VideoCompression] Source resolution:",
      `${metadata.width}x${metadata.height}`,
    );
  }

  // Codec is never reported by the metadata call, so the old check could never
  // fire. Rejecting on an unknown codec would mean rejecting every video.
  if (metadata.codec) {
    const unsupportedCodecs = ["prores", "dnxhd", "rawvideo"];
    if (unsupportedCodecs.includes(metadata.codec.toLowerCase())) {
      errors.push(`Unsupported codec: ${metadata.codec}`);
    }
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
  /**
   * The surface's byte budget. A clip already inside it is passed through
   * untouched; a larger one is encoded AT ITS OWN DIMENSIONS with a bitrate
   * sized to fit. When neither is possible the result says so instead of
   * shipping a ruined encode.
   */
  budgetBytes?: number,
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

    const plan: VideoPlan = planVideoUpload({
      sizeBytes: originalSize,
      budgetBytes: budgetBytes ?? originalSize,
      durationSec: metadata.duration,
      width: metadata.width,
      height: metadata.height,
      fps: metadata.fps,
    });
    console.log("[VideoCompression] Plan:", plan.action, "—", plan.reason);

    if (plan.action === "passthrough") {
      return {
        success: true,
        outputPath: inputUri,
        originalSize,
        compressedSize: originalSize,
        compressionRatio: 0,
        reencoded: false,
        width: metadata.width,
        height: metadata.height,
        plan,
      };
    }

    if (plan.action === "too_large") {
      // Never silently destroy detail to force a fit. The caller turns this
      // into a choice: trim, or export smaller on purpose.
      return {
        success: false,
        error: plan.fittingDurationSec
          ? `That clip is too long for this quality. About ${plan.fittingDurationSec}s would fit — trim it, or choose a smaller export.`
          : "That clip cannot be prepared at this quality. Trim it, or choose a smaller export.",
        plan,
      };
    }

    // SMALLER — an explicit, stated encode. Dimensions and bitrate come from
    // the ladder, never from the library's defaults: omitting `maxSize` makes
    // react-native-compressor use 640 for the LONGER edge, which is what
    // turned 1080x1920 uploads into 360x640.
    if (COMPRESSOR_AVAILABLE && RNCompressorVideo) {
      console.log(
        "[VideoCompression] Encoding at source size —",
        `maxSize=${plan.maxLongEdge} bitrate=${plan.videoBitrateBps}`,
        `bpp=${plan.bitsPerPixel?.toFixed(3)}`,
      );

      let cancellationId: string | undefined;
      const compressedUri = await withUploadTimeout(RNCompressorVideo.compress(
        inputUri,
        {
          compressionMethod: "manual",
          maxSize: plan.maxLongEdge,
          bitrate: plan.videoBitrateBps,
          minimumFileSizeForCompress: 0,
          getCancellationId: (id) => { cancellationId = id; },
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
      ), () => { if (cancellationId) RNCompressorVideo?.cancelCompression(cancellationId); }, 180_000);

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

      // "The encoder returned" is not "the output is good". A copy that is
      // bigger than the source, or a sliver of it, is a failed export with a
      // success return value — keep the source rather than publish damage.
      const verdict = isUsablePreparedCopy(
        originalSize,
        compressedSize,
        budgetBytes ?? originalSize,
      );
      if (!verdict.usable) {
        console.warn(
          "[VideoCompression] Discarding smaller copy —",
          verdict.reason,
        );
        return {
          success: true,
          outputPath: inputUri,
          originalSize,
          compressedSize: originalSize,
          compressionRatio: 0,
          reencoded: false,
          width: metadata.width,
          height: metadata.height,
        };
      }

      return {
        success: true,
        outputPath: compressedUri,
        originalSize,
        compressedSize,
        compressionRatio: ratio,
        reencoded: true,
        width: metadata.width,
        height: metadata.height,
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
      reencoded: false,
      width: metadata.width,
      height: metadata.height,
    };
  } catch (error) {
    console.error("[VideoCompression] Compression error:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Video compression failed. Please try again.",
    };
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




