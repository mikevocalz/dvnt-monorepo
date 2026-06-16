/**
 * Video Compression Helper
 * 
 * Uses react-native-compressor for native video compression.
 * Requires dev client build (not Expo Go).
 */

import { Video } from "react-native-compressor";

export type VideoKind = "post-video" | "story-video" | "message-video";

export interface VideoCompressionResult {
  uri: string;
  sizeBytes: number;
  mime: "video/mp4";
  compressed: boolean;
}

export interface VideoCompressionInput {
  uri: string;
  kind: VideoKind;
  durationSec: number;
  sizeBytes: number;
}

// Hard size limits per kind (in bytes)
const SIZE_LIMITS: Record<VideoKind, number> = {
  "message-video": 12 * 1024 * 1024,  // 12 MB
  "story-video": 28 * 1024 * 1024,    // 28 MB — allows 1080p output
  "post-video": 32 * 1024 * 1024,     // 32 MB — allows 1080p output
};

// Max output resolution per kind. Stories and posts play full-screen on
// 1080p+ devices; 720p source was visibly soft after upscale (story-video
// blur incident, May 2026). Messages stay at 720 since they preview inline.
const MAX_SIZE_BY_KIND: Record<VideoKind, number> = {
  "message-video": 720,
  "story-video": 1080,
  "post-video": 1080,
};

const MAX_DURATION_SEC = 60;

export class VideoCompressionError extends Error {
  constructor(message: string, public code: string) {
    super(message);
    this.name = "VideoCompressionError";
  }
}

/**
 * Get file size from URI
 */
async function getFileSize(uri: string): Promise<number> {
  try {
    const response = await fetch(uri, { method: "HEAD" });
    const contentLength = response.headers.get("content-length");
    if (contentLength) {
      return parseInt(contentLength, 10);
    }
    
    // Fallback: fetch the file and check size
    const fullResponse = await fetch(uri);
    const blob = await fullResponse.blob();
    return blob.size;
  } catch (error) {
    console.warn("[compressVideo] Could not get file size:", error);
    return 0;
  }
}

/**
 * Compress video if needed based on kind and size limits
 * 
 * Rules:
 * 1. Duration MUST be <= 60 seconds (reject if longer)
 * 2. If under size limit, return original
 * 3. If over limit, compress once with conservative preset
 * 4. If still over limit after compression, reject
 */
export async function compressVideoIfNeeded(
  input: VideoCompressionInput
): Promise<VideoCompressionResult> {
  const { uri, kind, durationSec, sizeBytes } = input;
  const sizeLimit = SIZE_LIMITS[kind];

  console.log("[compressVideo] Starting:", {
    kind,
    durationSec,
    sizeMB: (sizeBytes / (1024 * 1024)).toFixed(2),
    limitMB: (sizeLimit / (1024 * 1024)).toFixed(1),
  });

  // Rule 1: Check duration
  if (durationSec > MAX_DURATION_SEC) {
    throw new VideoCompressionError(
      `Video too long: ${durationSec}s exceeds ${MAX_DURATION_SEC}s limit`,
      "DURATION_EXCEEDED"
    );
  }

  // Rule 2: If already under limit, return original
  if (sizeBytes <= sizeLimit) {
    console.log("[compressVideo] Already under limit, using original");
    return {
      uri,
      sizeBytes,
      mime: "video/mp4",
      compressed: false,
    };
  }

  console.log("[compressVideo] Over limit, compressing...");

  // Rule 3: Compress with conservative preset
  try {
    const compressedUri = await Video.compress(uri, {
      compressionMethod: "auto",
      maxSize: MAX_SIZE_BY_KIND[kind],
      minimumFileSizeForCompress: 0, // Always compress if we get here
    });

    // Get compressed file size
    const compressedSize = await getFileSize(compressedUri);
    
    console.log("[compressVideo] Compressed:", {
      originalMB: (sizeBytes / (1024 * 1024)).toFixed(2),
      compressedMB: (compressedSize / (1024 * 1024)).toFixed(2),
      reduction: `${((1 - compressedSize / sizeBytes) * 100).toFixed(1)}%`,
    });

    // Rule 4: Check if still over limit
    if (compressedSize > sizeLimit) {
      throw new VideoCompressionError(
        `Video still too large after compression: ${(compressedSize / (1024 * 1024)).toFixed(2)}MB exceeds ${(sizeLimit / (1024 * 1024)).toFixed(1)}MB limit. Please use a shorter or lower quality video.`,
        "SIZE_EXCEEDED_AFTER_COMPRESSION"
      );
    }

    return {
      uri: compressedUri,
      sizeBytes: compressedSize,
      mime: "video/mp4",
      compressed: true,
    };
  } catch (error) {
    if (error instanceof VideoCompressionError) {
      throw error;
    }

    console.error("[compressVideo] Compression failed:", error);

    // If compression fails but original is under limit, use original
    if (sizeBytes <= sizeLimit) {
      console.log("[compressVideo] Compression failed but original under limit, using original");
      return {
        uri,
        sizeBytes,
        mime: "video/mp4",
        compressed: false,
      };
    }

    throw new VideoCompressionError(
      `Video compression failed and original exceeds size limit. Please use a smaller video.`,
      "COMPRESSION_FAILED"
    );
  }
}

/**
 * Validate video before compression
 */
export function validateVideoForUpload(
  durationSec: number,
  sizeBytes: number,
  kind: VideoKind
): { valid: boolean; error?: string } {
  if (durationSec > MAX_DURATION_SEC) {
    return {
      valid: false,
      error: `Video must be ${MAX_DURATION_SEC} seconds or less (yours is ${Math.round(durationSec)}s)`,
    };
  }

  // We allow larger files since we'll compress them
  // But warn if they're extremely large (likely to fail compression)
  const extremeLimit = SIZE_LIMITS[kind] * 5; // 5x the limit
  if (sizeBytes > extremeLimit) {
    return {
      valid: false,
      error: `Video file is too large to process. Please use a smaller video.`,
    };
  }

  return { valid: true };
}
