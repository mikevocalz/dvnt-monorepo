/**
 * Video thumbnail generation utility using expo-video-thumbnails
 */

import * as VideoThumbnails from "expo-video-thumbnails";
import * as LegacyFileSystem from "expo-file-system/legacy";

const FileSystem = LegacyFileSystem;

export interface ThumbnailResult {
  success: boolean;
  uri?: string;
  width?: number;
  height?: number;
  error?: string;
}

/**
 * Generate a thumbnail from a video file
 * @param videoUri - Local video URI (file://, content://, ph://)
 * @param timeMs - Time in milliseconds to capture the thumbnail (default: 0)
 * @returns ThumbnailResult with the thumbnail URI or error
 */
export async function generateVideoThumbnail(
  videoUri: string,
  timeMs: number = 0,
  timeoutMs: number = 8000,
): Promise<ThumbnailResult> {
  console.log(
    "[VideoThumbnail] Generating thumbnail for:",
    videoUri.substring(0, 80),
  );
  console.log("[VideoThumbnail] Time position:", timeMs, "ms");

  try {
    const thumbnailPromise = VideoThumbnails.getThumbnailAsync(videoUri, {
      time: timeMs,
      quality: 0.8,
    });

    const timeoutPromise = new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error("Thumbnail generation timed out")),
        timeoutMs,
      ),
    );

    const result = await Promise.race([thumbnailPromise, timeoutPromise]);

    console.log("[VideoThumbnail] Generated successfully:", {
      width: result.width,
      height: result.height,
      uri: result.uri.substring(0, 80),
    });

    return {
      success: true,
      uri: result.uri,
      width: result.width,
      height: result.height,
    };
  } catch (error) {
    console.error("[VideoThumbnail] Generation failed:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Generate multiple thumbnails at different timestamps
 * Useful for letting users pick a cover image
 * @param videoUri - Local video URI
 * @param timestamps - Array of timestamps in milliseconds
 * @returns Array of ThumbnailResults
 */
export async function generateMultipleThumbnails(
  videoUri: string,
  timestamps: number[] = [0, 1000, 2000, 3000],
): Promise<ThumbnailResult[]> {
  console.log("[VideoThumbnail] Generating", timestamps.length, "thumbnails");

  const results: ThumbnailResult[] = [];

  for (const time of timestamps) {
    const result = await generateVideoThumbnail(videoUri, time);
    results.push(result);
  }

  const successCount = results.filter((r) => r.success).length;
  console.log(
    "[VideoThumbnail] Generated",
    successCount,
    "of",
    timestamps.length,
    "thumbnails",
  );

  return results;
}

/**
 * Clean up a temporary thumbnail file
 * @param uri - Thumbnail URI to delete
 */
export async function cleanupThumbnail(uri: string): Promise<void> {
  try {
    if (uri.startsWith("file://")) {
      await FileSystem.deleteAsync(uri, { idempotent: true });
      console.log("[VideoThumbnail] Cleaned up:", uri.substring(0, 50));
    }
  } catch (error) {
    console.warn("[VideoThumbnail] Cleanup failed:", error);
  }
}
