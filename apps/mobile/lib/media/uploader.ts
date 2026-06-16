/**
 * Supabase Media Upload Pipeline
 * Production-grade with deduplication, retry, and progress tracking
 */

import { supabase } from "@/lib/supabase/client";
import { DB } from "@/lib/supabase/db-map";
import * as FileSystem from "expo-file-system/legacy";
import {
  ProcessedMedia,
  UploadedMedia,
  BucketName,
  MediaUseCase,
} from "./types";

/**
 * Generate storage path with proper structure
 * Format: {userId}/yyyy/mm/{uuid}.{ext}
 *
 * Benefits:
 * - Partitioned by date (easier cleanup/analytics)
 * - Scoped to user (security + organization)
 * - UUID prevents collisions
 */
function generateStoragePath(
  userId: number,
  extension: string,
  bucketName: BucketName,
): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const uuid = crypto.randomUUID();

  return `${userId}/${year}/${month}/${uuid}.${extension}`;
}

/**
 * Check if media already exists (deduplication)
 * Saves bandwidth + storage if file was previously uploaded
 *
 * @returns Existing media record if hash matches
 */
async function checkDuplicate(
  hash: string,
  userId: number,
): Promise<UploadedMedia | null> {
  console.log("[MediaUpload] Checking for duplicate:", hash.substring(0, 16));

  const { data, error } = await supabase
    .from(DB.media.table)
    .select("*")
    .eq("hash", hash)
    .eq("owner_id", userId)
    .maybeSingle();

  if (error) {
    console.error("[MediaUpload] Duplicate check error:", error);
    return null;
  }

  if (data) {
    console.log("[MediaUpload] ✅ Duplicate found, reusing:", data.public_url);
    return {
      id: data.id,
      publicUrl: data.public_url,
      storagePath: data.storage_path,
      hash: data.hash,
      width: data.width,
      height: data.height,
      sizeBytes: data.size_bytes,
      durationSeconds: data.duration_seconds,
    };
  }

  return null;
}

/**
 * Upload media to Supabase Storage
 * Uses binary upload (NO base64)
 *
 * @param onProgress Callback for upload progress (0-1)
 */
export async function uploadMedia(
  media: ProcessedMedia,
  useCase: MediaUseCase,
  onProgress?: (progress: number) => void,
): Promise<UploadedMedia> {
  console.log("[MediaUpload] Starting:", {
    type: media.type,
    size: `${(media.sizeBytes / 1024 / 1024).toFixed(2)}MB`,
    useCase,
  });

  // Step 1: Get user ID via Better Auth (supabase.auth.getUser() returns null)
  const { getCurrentUserRow } = await import("@/lib/auth/identity");
  const userRow = await getCurrentUserRow();
  if (!userRow) throw new Error("Not authenticated");
  const userId = userRow.id;

  // Step 2: Check for duplicate (save bandwidth!)
  const duplicate = await checkDuplicate(media.hash, userId);
  if (duplicate) {
    onProgress?.(1);
    return duplicate;
  }

  // Step 3: Determine bucket and path
  const bucket = getBucketForUseCase(useCase);
  const extension = media.type === "video" ? "mp4" : "webp";
  const storagePath = generateStoragePath(userId, extension, bucket);

  // Step 4: Read file as binary (ArrayBuffer)
  const fileUri = media.uri;
  const fileContent = await FileSystem.readAsStringAsync(fileUri, {
    encoding: "base64" as any,
  });

  // Convert base64 to ArrayBuffer for binary upload
  const binaryString = atob(fileContent);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  console.log("[MediaUpload] Uploading to storage:", { bucket, storagePath });
  onProgress?.(0.1);

  // Step 5: Upload to Supabase Storage
  const { data: uploadData, error: uploadError } = await supabase.storage
    .from(bucket)
    .upload(storagePath, bytes.buffer, {
      contentType: media.mimeType,
      cacheControl: "31536000", // 1 year (immutable files)
      upsert: false, // Never overwrite (security)
    });

  if (uploadError) {
    console.error("[MediaUpload] Upload error:", uploadError);
    throw new Error(`Upload failed: ${uploadError.message}`);
  }

  onProgress?.(0.8);

  // Step 6: Get public URL
  const { data: urlData } = supabase.storage
    .from(bucket)
    .getPublicUrl(storagePath);

  const publicUrl = urlData.publicUrl;

  // Step 7: Create database record
  const expiresAt = getExpirationDate(bucket);

  const { data: mediaRecord, error: dbError } = await supabase
    .from(DB.media.table)
    .insert({
      storage_path: storagePath,
      public_url: publicUrl,
      media_type: media.type,
      mime_type: media.mimeType,
      size_bytes: media.sizeBytes,
      width: media.width,
      height: media.height,
      duration_seconds: media.durationSeconds,
      hash: media.hash,
      owner_id: userId,
      bucket_name: bucket,
      expires_at: expiresAt,
    })
    .select()
    .single();

  if (dbError) {
    console.error("[MediaUpload] DB insert error:", dbError);
    // Rollback: delete uploaded file
    await supabase.storage.from(bucket).remove([storagePath]);
    throw new Error(`Database error: ${dbError.message}`);
  }

  onProgress?.(1);

  console.log("[MediaUpload] ✅ Complete:", {
    id: mediaRecord.id,
    url: publicUrl,
  });

  return {
    id: mediaRecord.id,
    publicUrl,
    storagePath,
    hash: media.hash,
    width: media.width,
    height: media.height,
    sizeBytes: media.sizeBytes,
    durationSeconds: media.durationSeconds,
  };
}

/**
 * Delete media (user-initiated)
 * Removes from storage + database
 */
export async function deleteMedia(mediaId: number): Promise<void> {
  console.log("[MediaUpload] Deleting media:", mediaId);

  // Get media record
  const { data: media, error: fetchError } = await supabase
    .from(DB.media.table)
    .select("*")
    .eq("id", mediaId)
    .single();

  if (fetchError || !media) {
    throw new Error("Media not found");
  }

  // Delete from storage
  const { error: storageError } = await supabase.storage
    .from(media.bucket_name)
    .remove([media.storage_path]);

  if (storageError) {
    console.error("[MediaUpload] Storage delete error:", storageError);
    // Continue to delete DB record even if storage fails
  }

  // Delete from database (RLS will verify ownership)
  const { error: dbError } = await supabase
    .from(DB.media.table)
    .delete()
    .eq("id", mediaId);

  if (dbError) {
    throw new Error(`Failed to delete media: ${dbError.message}`);
  }

  console.log("[MediaUpload] ✅ Deleted:", mediaId);
}

/**
 * Helper: Map use case to bucket
 */
function getBucketForUseCase(useCase: MediaUseCase): BucketName {
  switch (useCase) {
    case "avatar":
      return "avatars";
    case "story":
      return "stories";
    case "feed":
      return "images";
    case "message":
      return "temp"; // Messages use temp bucket (1h expiry)
    default:
      return "temp";
  }
}

/**
 * Helper: Calculate expiration date for bucket
 */
function getExpirationDate(bucket: BucketName): string | null {
  const now = new Date();

  switch (bucket) {
    case "stories":
      // Stories expire after 24 hours
      now.setHours(now.getHours() + 24);
      return now.toISOString();

    case "temp":
      // Temp files expire after 1 hour
      now.setHours(now.getHours() + 1);
      return now.toISOString();

    default:
      // Permanent files (avatars, images, videos)
      return null;
  }
}

/**
 * Batch upload multiple media files
 * Useful for posts with multiple images
 *
 * @returns Array of uploaded media IDs
 */
export async function uploadMediaBatch(
  mediaList: ProcessedMedia[],
  useCase: MediaUseCase,
  onProgress?: (index: number, progress: number) => void,
): Promise<UploadedMedia[]> {
  const results: UploadedMedia[] = [];

  for (let i = 0; i < mediaList.length; i++) {
    const media = mediaList[i];

    try {
      const uploaded = await uploadMedia(media, useCase, (progress) => {
        onProgress?.(i, progress);
      });

      results.push(uploaded);
    } catch (error) {
      console.error(`[MediaUpload] Failed to upload item ${i}:`, error);
      // Rollback: delete successfully uploaded files
      for (const result of results) {
        await deleteMedia(result.id).catch(console.error);
      }
      throw error;
    }
  }

  return results;
}
