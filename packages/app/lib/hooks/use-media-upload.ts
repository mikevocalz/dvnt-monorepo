/**
 * React hook for media uploads to Bunny.net CDN
 *
 * CRITICAL RULES:
 * - RAW VIDEO MUST NEVER BE UPLOADED
 * - ALL VIDEOS MUST BE COMPRESSED LOCALLY BEFORE UPLOAD
 * - IF COMPRESSION FAILS → UPLOAD MUST BE BLOCKED
 *
 * Flow for videos:
 * 1. Validate video (duration, size, resolution)
 * 2. Compress using FFmpeg (MANDATORY)
 * 3. Generate thumbnail from original
 * 4. Upload compressed video
 * 5. Upload thumbnail
 * 6. Clean up temp files
 */

import { useState, useCallback } from "react";
import { sizeLimitForKind } from "@dvnt/app/lib/media/upload-policy";
import { Platform } from "react-native";
import {
  uploadToServer as serverUpload,
  deleteFromServer,
  type ServerUploadResult,
  type UploadProgress,
} from "@dvnt/app/lib/server-upload";
import { getVideoThumbnail } from "@dvnt/app/lib/media/getVideoThumbnail";
import { generateBlurPlaceholder } from "@dvnt/app/lib/media/image-processor";

import { manipulateAsync, SaveFormat } from "expo-image-manipulator";
import {
  compressVideo,
  validateVideo,
  cleanupCompressedVideo,
} from "@dvnt/app/lib/video-compression";
import {
  generateVideoThumbnail,
  cleanupThumbnail,
} from "@dvnt/app/lib/video-thumbnail";
import * as LegacyFileSystem from "expo-file-system/legacy";

const FileSystem = LegacyFileSystem;

export type UploadResult = ServerUploadResult;

export interface UseMediaUploadOptions {
  folder?: string;
  userId?: string;
  onSuccess?: (results: ServerUploadResult[]) => void;
  onError?: (error: string) => void;
}

export interface MediaFile {
  uri: string;
  type: "image" | "video";
  kind?: import("@dvnt/app/lib/media/types").MediaKind;
  mimeType?: string;
  pairedVideoUri?: string; // Live Photo paired video (iOS)
  /**
   * Dimensions the picker measured, when it reported them. Used as the source
   * of truth for the stored row when the native metadata call cannot read the
   * file itself. Never a default — absent means unknown.
   */
  width?: number | null;
  height?: number | null;
}

export interface MediaUploadResult {
  type: "image" | "video";
  kind?: import("@dvnt/app/lib/media/types").MediaKind;
  url: string;
  path?: string;
  thumbnail?: string;
  thumbnailPath?: string;
  mimeType?: string;
  livePhotoVideoUrl?: string;
  /** Compact inline fade-in placeholder (base64 WebP data URI) for images. */
  blurhash?: string;
  success: boolean;
  error?: string;
  compressionStats?: {
    originalSize: number;
    compressedSize: number;
    reductionPercent: number;
  };
  /**
   * Measured source dimensions, when the platform could read them. Every one
   * of the 179 video rows in production has NULL width/height, so no surface
   * can tell what it is playing — including the surfaces that would need it to
   * choose a rendition.
   */
  width?: number | null;
  height?: number | null;
  /**
   * False for an untouched original, true for a copy an encoder produced.
   * Stored so nothing downstream has to guess whether these are the member's
   * own bytes.
   */
  reencoded?: boolean;
}

async function assertReadableMediaUri(uri: string): Promise<void> {
  if (!uri.startsWith("file://")) {
    return;
  }

  const info = await FileSystem.getInfoAsync(uri).catch(() => null);
  if (info?.exists) {
    return;
  }

  throw new Error(
    "Selected media is no longer available. Please remove it and choose it again.",
  );
}

/**
 * The MIME type of the bytes we are actually sending.
 *
 * A re-encode produces MP4 and may honestly say so. A pass-through must keep
 * the source's own type: a QuickTime file declared as `video/mp4` is a rename,
 * not a conversion, and it is how 43 stored rows ended up describing a
 * container they are not. `reencoded` is the only thing that licenses "mp4".
 */
/**
 * The byte budget for video from this surface, read from the one policy table
 * the Edge Function is pinned to. `folderToKind` in server-upload.ts does the
 * same mapping for the upload itself; this keeps preparation and validation
 * talking about the same number.
 */
function videoBudgetForFolder(folder: string): number {
  const kindByFolder: Record<string, string> = {
    posts: "post-video",
    stories: "story-video",
    chat: "message-video",
    events: "event-video",
    "event-moments": "event-moment-video",
    uploads: "post-video",
  };
  return sizeLimitForKind(kindByFolder[folder] ?? "post-video");
}

function uploadMimeForVideo(
  sourceUri: string,
  sourceMime: string | undefined,
  reencoded: boolean | undefined,
): string {
  if (reencoded) return "video/mp4";
  if (sourceMime) return sourceMime;
  return /\.mov(?:[?#]|$)/i.test(sourceUri) ? "video/quicktime" : "video/mp4";
}

export function useMediaUpload(options: UseMediaUploadOptions = {}) {
  const { folder = "uploads", userId, onSuccess, onError } = options;

  const [isUploading, setIsUploading] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [compressionProgress, setCompressionProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const uploadSingle = useCallback(
    async (uri: string): Promise<UploadResult> => {
      setIsUploading(true);
      setProgress(0);
      setError(null);

      const result = await serverUpload(uri, folder, (p) => {
        setProgress(p.percentage);
      });

      setIsUploading(false);

      if (result.success) {
        onSuccess?.([result]);
      } else {
        setError(result.error || "Upload failed");
        onError?.(result.error || "Upload failed");
      }

      return result;
    },
    [folder, userId, onSuccess, onError],
  );

  const uploadMultiple = useCallback(
    async (files: MediaFile[], onStatus?: (message: string) => void): Promise<MediaUploadResult[]> => {
      const reportStatus = (message: string | null) => {
        setStatusMessage(message);
        if (message) onStatus?.(message);
      };
      setIsUploading(true);
      setProgress(0);
      setCompressionProgress(0);
      setError(null);
      setStatusMessage(null);

      try {
      const results: MediaUploadResult[] = [];
      const videoCount = files.filter((f) => f.type === "video" && f.kind !== "animated_video").length;
      const animatedVideoCount = files.filter((f) => f.kind === "animated_video").length;
      const imageCount = files.length - videoCount - animatedVideoCount;
      const isStory = folder === "stories";
      const needsThumbnail = isStory || folder === "posts";
      // Story videos add a thumbnail generation/reconciliation step before publish.
      const videoSteps = needsThumbnail ? 4 : 3;
      const totalSteps = videoCount * videoSteps + animatedVideoCount * 2 + imageCount;
      let completedSteps = 0;

      const reportBytes = (p: UploadProgress) => {
        setProgress(Math.round(((completedSteps + p.percentage / 100) / Math.max(totalSteps, 1)) * 100));
      };
      const updateProgress = (message?: string) => {
        completedSteps++;
        setProgress(Math.round((completedSteps / totalSteps) * 100));
        if (message) reportStatus(message);
      };

      for (const file of files) {
        console.log(
          "[useMediaUpload] Processing file:",
          file.type,
          file.uri.substring(0, 50),
        );

        try {
          await assertReadableMediaUri(file.uri);
          if (file.pairedVideoUri) {
            await assertReadableMediaUri(file.pairedVideoUri);
          }
        } catch (mediaError: any) {
          const skippedSteps = file.kind === "animated_video" ? 2 : file.type === "video" ? videoSteps : 1;
          results.push({
            type: file.type,
            kind: file.kind,
            url: "",
            success: false,
            error:
              mediaError?.message ||
              "Selected media is no longer available. Please choose it again.",
          });
          completedSteps += skippedSteps;
          setProgress(Math.round((completedSteps / totalSteps) * 100));
          continue;
        }

        if (file.type === "video" && file.kind !== "animated_video") {
          // ========== VIDEO: PUBLISHED AS SELECTED ==========
          // No encoder runs here. `compressVideo` defaults to `original`, which
          // validates and hands the same file back. Publishing a video is not a
          // reason to change it.
          console.log(
            "[useMediaUpload] ========== VIDEO PIPELINE (original) ==========",
          );

          // Step 1: Validate video
          reportStatus("Validating video...");
          const validation = await validateVideo(file.uri);
          if (!validation.valid) {
            console.error(
              "[useMediaUpload] Video validation failed:",
              validation.errors,
            );
            results.push({
              type: "video",
              url: "",
              success: false,
              error: `Video rejected: ${validation.errors.join(", ")}`,
            });
            // Skip remaining steps for this file
            completedSteps += videoSteps;
            setProgress(Math.round((completedSteps / totalSteps) * 100));
            continue;
          }
          updateProgress("Video validated");

          // Step 2: prepare — original mode, so this is a pass-through. The
          // status says "Preparing", not "Compressing": nothing is being
          // compressed, and the old label described work that no longer
          // happens (and, when it did happen, was the bug).
          reportStatus("Preparing video...");
          const compressionResult = await compressVideo(
            file.uri,
            (p) => setCompressionProgress(p.percentage),
            // The budget belongs to the surface: a story is 18MiB, a post
            // 25MiB. Passing it here is what lets a clip that already fits be
            // uploaded untouched, and a larger one be encoded to fit at its
            // own resolution.
            videoBudgetForFolder(folder),
          );

          if (!compressionResult.success || !compressionResult.outputPath) {
            console.error(
              "[useMediaUpload] Video could not be prepared:",
              compressionResult.error,
            );
            results.push({
              type: "video",
              url: "",
              success: false,
              error: compressionResult.error || "Could not read that video.",
            });
            // Skip remaining steps
            completedSteps += videoSteps - 1;
            setProgress(Math.round((completedSteps / totalSteps) * 100));
            continue;
          }

          console.log("[useMediaUpload] Compression SUCCESS:", {
            originalMB: Math.round(
              (compressionResult.originalSize || 0) / 1024 / 1024,
            ),
            compressedMB: Math.round(
              (compressionResult.compressedSize || 0) / 1024 / 1024,
            ),
            reduction: compressionResult.compressionRatio + "%",
          });
          updateProgress("Video compressed");

          let thumbnailAssetUri: string | undefined;
          let thumbnailUrl: string | undefined;
          let thumbnailPath: string | undefined;
          let thumbnailNeedsCleanup = false;

          if (needsThumbnail) {
            reportStatus("Generating video thumbnail...");
            const localThumbnailSources = [
              compressionResult.outputPath,
              file.uri,
            ].filter(Boolean) as string[];

            for (const candidateUri of localThumbnailSources) {
              const thumbnailResult = await generateVideoThumbnail(
                candidateUri,
                1000,
                3500,
              );

              if (thumbnailResult.success && thumbnailResult.uri) {
                thumbnailAssetUri = thumbnailResult.uri;
                thumbnailNeedsCleanup = true;
                break;
              }
            }

            updateProgress(
              thumbnailAssetUri
                ? "Video preview ready"
                : "Preparing video preview",
            );
          }

          // Step 4: Upload COMPRESSED video (never raw)
          reportStatus("Uploading video...");
          const uploadResult = await serverUpload(
            compressionResult.outputPath,
            folder,
            reportBytes,
            {
              mimeType: uploadMimeForVideo(
                file.uri,
                file.mimeType,
                compressionResult.reencoded,
              ),
              // Measured — or absent. Sent so the stored row records the real
              // resolution instead of the NULL every existing video row has.
              width: compressionResult.width ?? file.width ?? null,
              height: compressionResult.height ?? file.height ?? null,
            },
          );

          // Clean up compressed file after upload
          await cleanupCompressedVideo(compressionResult.outputPath);

          if (!uploadResult.success) {
            console.error(
              "[useMediaUpload] Upload failed:",
              uploadResult.error,
            );
            results.push({
              type: "video",
              url: "",
              success: false,
              error: uploadResult.error,
            });
          } else {
            if (needsThumbnail) {
              if (!thumbnailAssetUri) {
                reportStatus("Preparing video preview...");
                thumbnailAssetUri =
                  (await getVideoThumbnail(uploadResult.url)) || undefined;
                thumbnailNeedsCleanup = false;
              }

              if (thumbnailAssetUri) {
                reportStatus("Uploading video preview...");
                const thumbnailUploadResult = await serverUpload(
                  thumbnailAssetUri,
                  folder,
                );

                if (thumbnailUploadResult.success) {
                  thumbnailUrl = thumbnailUploadResult.url;
                  thumbnailPath = thumbnailUploadResult.path;
                } else {
                  console.warn(
                    "[useMediaUpload] Story thumbnail upload failed:",
                    thumbnailUploadResult.error,
                  );
                }
              }

              if (thumbnailAssetUri && thumbnailNeedsCleanup) {
                await cleanupThumbnail(thumbnailAssetUri);
              }

              if (!thumbnailUrl && isStory) {
                if (uploadResult.path) {
                  await deleteFromServer([uploadResult.path]).catch((cleanupErr) =>
                    console.error(
                      "[useMediaUpload] Failed to clean up rolled-back story video:",
                      cleanupErr,
                    ),
                  );
                }

                results.push({
                  type: "video",
                  url: "",
                  success: false,
                  error:
                    "Failed to generate a story thumbnail. Please try another video.",
                });
                updateProgress("Upload blocked");
                console.error(
                  "[useMediaUpload] Story video blocked: thumbnail generation failed",
                );
                console.log(
                  "[useMediaUpload] ========== VIDEO PIPELINE COMPLETE ==========",
                );
                continue;
              }
            }
            results.push({
              type: "video",
              kind: "video",
              // Recorded as what it IS. This said "video/mp4" for every native
              // upload regardless of the container that was actually stored.
              mimeType: uploadMimeForVideo(
                file.uri,
                file.mimeType,
                compressionResult.reencoded,
              ),
              url: uploadResult.url,
              path: uploadResult.path,
              thumbnail: thumbnailUrl,
              thumbnailPath,
              success: true,
              width: compressionResult.width ?? file.width ?? null,
              height: compressionResult.height ?? file.height ?? null,
              reencoded: compressionResult.reencoded === true,
              compressionStats: {
                originalSize: compressionResult.originalSize || 0,
                compressedSize: compressionResult.compressedSize || 0,
                reductionPercent: compressionResult.compressionRatio || 0,
              },
            });
          }
          updateProgress("Upload complete");
          console.log(
            "[useMediaUpload] ========== VIDEO PIPELINE COMPLETE ==========",
          );
        } else if (file.kind === "animated_video") {
          // ========== ANIMATED VIDEO (short loop — compress + mark with special mimeType) ==========
          console.log("[useMediaUpload] Animated video — compress + mark as animated");
          // Looping clips take the same original path as any other video —
          // the label follows the work, and the work is no longer compression.
          reportStatus("Preparing video...");

          const compressionResult = await compressVideo(
            file.uri,
            (p) => setCompressionProgress(p.percentage),
            // The budget belongs to the surface: a story is 18MiB, a post
            // 25MiB. Passing it here is what lets a clip that already fits be
            // uploaded untouched, and a larger one be encoded to fit at its
            // own resolution.
            videoBudgetForFolder(folder),
          );

          if (!compressionResult.success || !compressionResult.outputPath) {
            results.push({
              type: "video",
              kind: "animated_video",
              url: "",
              success: false,
              error: compressionResult.error || "Animated video compression failed.",
            });
            updateProgress("Animated video failed");
          } else {
            reportStatus("Uploading animated video...");
            const uploadResult = await serverUpload(compressionResult.outputPath, folder, reportBytes, {
              mimeType: uploadMimeForVideo(
                file.uri,
                file.mimeType,
                compressionResult.reencoded,
              ),
              // Measured — or absent. Sent so the stored row records the real
              // resolution instead of the NULL every existing video row has.
              width: compressionResult.width ?? file.width ?? null,
              height: compressionResult.height ?? file.height ?? null,
            });
            let loopThumbnail: string | undefined;
            if (uploadResult.success && needsThumbnail) {
              reportStatus("Preparing video preview...");
              const preview = await generateVideoThumbnail(compressionResult.outputPath, 0);
              if (preview.success && preview.uri) {
                const previewUpload = await serverUpload(preview.uri, folder);
                if (previewUpload.success) loopThumbnail = previewUpload.url;
                await cleanupThumbnail(preview.uri);
              }
            }
            await cleanupCompressedVideo(compressionResult.outputPath);

            if (!uploadResult.success) {
              results.push({
                type: "video",
                kind: "animated_video",
                url: "",
                success: false,
                error: uploadResult.error,
              });
            } else {
              results.push({
                type: "video",
                kind: "animated_video",
                url: uploadResult.url,
                thumbnail: loopThumbnail,
                mimeType: "video/mp4+animated",
                success: true,
              });
            }
            updateProgress("Animated video uploaded");
          }
        } else if (file.kind === "gif") {
          // ========== GIF PROCESSING (NO compression — would destroy frames) ==========
          console.log("[useMediaUpload] GIF detected — skipping compression");
          reportStatus("Uploading GIF...");
          // ph:// URIs don't carry extension info — copy to a .gif cache file so the
          // upload pipeline uses the correct mime type and extension.
          let gifUri = file.uri;
          if (!gifUri.startsWith("file://")) {
            try {
              const dest = `${FileSystem.cacheDirectory}gif_${Date.now()}.gif`;
              await FileSystem.copyAsync({ from: gifUri, to: dest });
              gifUri = dest;
            } catch (copyErr) {
              console.warn("[useMediaUpload] GIF ph:// copy failed:", copyErr);
            }
          }
          const uploadResult = await serverUpload(gifUri, folder, reportBytes);
          if (!uploadResult.success) {
            results.push({
              type: "image",
              kind: "gif",
              url: "",
              success: false,
              error: uploadResult.error,
              mimeType: "image/gif",
            });
          } else {
            results.push({
              type: "image",
              kind: "gif",
              url: uploadResult.url,
              success: true,
              mimeType: "image/gif",
            });
          }
          updateProgress("GIF uploaded");
        } else if (file.kind === "livePhoto" && file.pairedVideoUri) {
          // ========== LIVE PHOTO PROCESSING (upload still + paired video) ==========
          console.log(
            "[useMediaUpload] Live Photo detected — uploading still + paired video",
          );
          reportStatus("Uploading Live Photo...");

          // Upload the still UNALTERED. Running it through manipulateAsync
          // (resize / re-encode to JPEG) strips the Apple Live Photo
          // pairing metadata that PHLivePhoto requires to instantiate
          // the pair on another device. Without that metadata the
          // native LivePhotoView fires onLoadError and the component
          // falls back to a static image — which was the real cause of
          // "Live Photos don't play" in prod.
          const stillResult = await serverUpload(file.uri, folder);

          // Upload the paired video (no compression — short clip, Live Photo quality must be preserved)
          reportStatus("Uploading Live Photo video...");
          const videoResult = await serverUpload(file.pairedVideoUri, folder);

          if (!stillResult.success) {
            results.push({
              type: "image",
              kind: "livePhoto",
              url: "",
              success: false,
              error: stillResult.error,
            });
          } else {
            results.push({
              type: "image",
              kind: "livePhoto",
              url: stillResult.url,
              livePhotoVideoUrl: videoResult.success
                ? videoResult.url
                : undefined,
              mimeType: file.mimeType,
              success: true,
            });
          }
          updateProgress("Live Photo uploaded");
        } else {
          // ========== IMAGE PROCESSING (compress + upload) ==========
          reportStatus("Optimizing image...");
          let imageUri = file.uri;
          try {
            const compressed = await manipulateAsync(
              file.uri,
              [{ rotate: 0 }, { resize: { width: 1440 } }],
              { compress: 0.85, format: SaveFormat.JPEG },
            );
            imageUri = compressed.uri;
            console.log(
              "[useMediaUpload] Image optimized:",
              imageUri.substring(0, 50),
            );
          } catch (compressErr) {
            console.warn(
              "[useMediaUpload] Image optimization failed, using original:",
              compressErr,
            );
          }

          // Compact fade-in placeholder from the downscaled image, sent
          // alongside the upload so the media row's `blurhash` column populates.
          // Never blocks the upload (returns undefined on failure).
          const blurhash = await generateBlurPlaceholder(imageUri);

          reportStatus("Uploading image...");
          const uploadResult = await serverUpload(imageUri, folder, reportBytes, {
            blurhash,
          });

          if (!uploadResult.success) {
            results.push({
              type: "image",
              kind: "image",
              url: "",
              success: false,
              error: uploadResult.error,
            });
          } else {
            results.push({
              type: "image",
              kind: "image",
              url: uploadResult.url,
              blurhash,
              success: true,
            });
          }
          updateProgress("Image uploaded");
        }
      }

      setIsUploading(false);
      reportStatus(null);

      const successResults = results.filter((r) => r.success);
      const failedResults = results.filter((r) => !r.success);
      const failedCount = failedResults.length;

      if (failedCount > 0) {
        console.error("[useMediaUpload] Upload failures:", failedResults);
        const errorMsg =
          failedResults[0]?.error || `${failedCount} file(s) failed to upload`;
        setError(errorMsg);
        onError?.(errorMsg);
      }

      if (successResults.length > 0) {
        onSuccess?.(
          successResults.map((r) => ({
            success: true,
            url: r.url,
            path: "",
            filename: "",
          })),
        );
      }

      return results;
      } finally {
        setIsUploading(false);
        setIsCompressing(false);
        setStatusMessage(null);
      }
    },
    [folder, userId, onSuccess, onError],
  );

  const reset = useCallback(() => {
    setIsUploading(false);
    setIsCompressing(false);
    setProgress(0);
    setCompressionProgress(0);
    setError(null);
    setStatusMessage(null);
  }, []);

  // Immediately cancels the upload UI state — use when user taps Cancel on the overlay.
  // The underlying network request will still complete/timeout, but the UI is unblocked.
  const cancelUpload = useCallback(() => {
    setIsUploading(false);
    setIsCompressing(false);
    setProgress(0);
    setCompressionProgress(0);
    setError(null);
    setStatusMessage(null);
  }, []);

  return {
    isUploading,
    isCompressing,
    progress,
    compressionProgress,
    error,
    statusMessage,
    uploadSingle,
    uploadMultiple,
    reset,
    cancelUpload,
  };
}
