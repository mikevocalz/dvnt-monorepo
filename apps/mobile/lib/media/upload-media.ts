/**
 * Unified Media Upload Client API
 *
 * Uploads media to Supabase Edge Function which handles Bunny CDN storage.
 * Bunny credentials NEVER exposed to client.
 */

import * as LegacyFileSystem from "expo-file-system/legacy";
import { supabase } from "@/lib/supabase/client";
import {
  compressAvatar,
  compressStoryImage,
  compressPostImage,
  compressEventCover,
  compressMessageImage,
} from "./compress-image";
import {
  compressVideoIfNeeded,
  validateVideoForUpload,
  VideoKind,
  VideoCompressionError,
} from "./compress-video";

// Use legacy FileSystem APIs
const FileSystem = LegacyFileSystem;

export type MediaKind =
  | "avatar"
  | "post-image"
  | "post-video"
  | "story-image"
  | "story-video"
  | "event-cover"
  | "event-image"
  | "message-image"
  | "message-video";

export interface UploadMediaInput {
  uri: string;
  kind: MediaKind;
  mimeType?: string;
  durationSec?: number;
  width?: number;
  height?: number;
}

export interface UploadMediaResult {
  ok: boolean;
  media?: {
    id: string;
    kind: string;
    url: string;
    key: string;
    mime: string;
    size: number;
    durationSec?: number;
    width?: number;
    height?: number;
  };
  error?: string;
}

// Edge function URL - uses Supabase project URL
const getEdgeFunctionUrl = () => {
  const raw = process.env.EXPO_PUBLIC_SUPABASE_URL;
  const supabaseUrl =
    typeof raw === "string" && raw.startsWith("https://")
      ? raw
      : "https://npfjanxturvmjyevoyfo.supabase.co";
  return `${supabaseUrl}/functions/v1/media-upload`;
};

/**
 * Get file info from URI
 */
async function getFileInfo(
  uri: string,
): Promise<{ size: number; exists: boolean }> {
  try {
    const info = await FileSystem.getInfoAsync(uri);
    return {
      size: info.exists && "size" in info ? info.size : 0,
      exists: info.exists,
    };
  } catch {
    return { size: 0, exists: false };
  }
}

/**
 * Detect mime type from URI
 */
function detectMimeType(uri: string, providedMime?: string): string {
  if (providedMime) return providedMime;

  const ext = uri.split(".").pop()?.toLowerCase();
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    mp4: "video/mp4",
    mov: "video/quicktime",
  };

  return mimeMap[ext || ""] || "application/octet-stream";
}

/**
 * Check if kind is a video type
 */
function isVideoKind(kind: MediaKind): boolean {
  return (
    kind === "post-video" || kind === "story-video" || kind === "message-video"
  );
}

/**
 * Compress media based on kind
 */
async function compressMedia(
  uri: string,
  kind: MediaKind,
  durationSec?: number,
  sizeBytes?: number,
): Promise<{
  uri: string;
  width?: number;
  height?: number;
  sizeBytes: number;
  mime: string;
}> {
  if (isVideoKind(kind)) {
    // Video compression
    if (durationSec === undefined) {
      throw new Error("durationSec is required for video uploads");
    }

    const fileInfo = await getFileInfo(uri);
    const size = sizeBytes || fileInfo.size;

    // Validate before compression
    const validation = validateVideoForUpload(
      durationSec,
      size,
      kind as VideoKind,
    );
    if (!validation.valid) {
      throw new Error(validation.error);
    }

    const result = await compressVideoIfNeeded({
      uri,
      kind: kind as VideoKind,
      durationSec,
      sizeBytes: size,
    });

    return {
      uri: result.uri,
      sizeBytes: result.sizeBytes,
      mime: result.mime,
    };
  }

  // Image compression based on kind
  let compressed;
  switch (kind) {
    case "avatar":
      compressed = await compressAvatar(uri);
      break;
    case "story-image":
      compressed = await compressStoryImage(uri);
      break;
    case "event-cover":
      compressed = await compressEventCover(uri);
      break;
    case "message-image":
      compressed = await compressMessageImage(uri);
      break;
    default:
      compressed = await compressPostImage(uri);
  }

  const fileInfo = await getFileInfo(compressed.uri);

  return {
    uri: compressed.uri,
    width: compressed.width,
    height: compressed.height,
    sizeBytes: fileInfo.size,
    mime: compressed.mimeType,
  };
}

/**
 * Upload media to server
 *
 * This function:
 * 1. Compresses the media based on kind
 * 2. Gets the current user's JWT
 * 3. Uploads to Supabase Edge Function
 * 4. Returns the media record
 */
export async function uploadMedia(
  input: UploadMediaInput,
): Promise<UploadMediaResult> {
  const { uri, kind, mimeType, durationSec, width, height } = input;

  console.log("[uploadMedia] Starting upload:", {
    kind,
    uri: uri.substring(0, 50),
  });

  try {
    // Get current session
    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();
    if (sessionError || !session) {
      console.error("[uploadMedia] No session:", sessionError?.message);
      return { ok: false, error: "Not authenticated" };
    }

    // Compress media
    console.log("[uploadMedia] Compressing media...");
    let processedUri = uri;
    let processedWidth = width;
    let processedHeight = height;
    let processedSize = 0;
    let processedMime = detectMimeType(uri, mimeType);

    try {
      const compressed = await compressMedia(uri, kind, durationSec);
      processedUri = compressed.uri;
      processedWidth = compressed.width || width;
      processedHeight = compressed.height || height;
      processedSize = compressed.sizeBytes;
      processedMime = compressed.mime;
      console.log("[uploadMedia] Compression complete:", {
        sizeMB: (processedSize / (1024 * 1024)).toFixed(2),
      });
    } catch (compressError) {
      if (compressError instanceof VideoCompressionError) {
        return { ok: false, error: compressError.message };
      }
      console.warn(
        "[uploadMedia] Compression failed, using original:",
        compressError,
      );
      const fileInfo = await getFileInfo(uri);
      processedSize = fileInfo.size;
    }

    // Read file as base64 for upload
    console.log("[uploadMedia] Reading file...");
    const base64 = await FileSystem.readAsStringAsync(processedUri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    // Convert base64 to binary
    const binaryString = atob(base64);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }

    // Generate filename
    const ext = processedMime.split("/")[1] || "bin";
    const filename = `upload_${Date.now()}.${ext}`;

    // Upload to Edge Function
    console.log("[uploadMedia] Uploading to Edge Function...");
    const edgeFunctionUrl = getEdgeFunctionUrl();

    const response = await fetch(edgeFunctionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        "Content-Type": processedMime,
        "x-kind": kind,
        "x-file-name": filename,
        "x-mime": processedMime,
        ...(isVideoKind(kind) &&
          durationSec !== undefined && {
            "x-duration-sec": String(durationSec),
          }),
        ...(processedWidth && { "x-width": String(processedWidth) }),
        ...(processedHeight && { "x-height": String(processedHeight) }),
      },
      body: bytes,
    });

    const result = await response.json();

    if (!response.ok) {
      console.error("[uploadMedia] Upload failed:", result);
      return {
        ok: false,
        error: result.error || `Upload failed with status ${response.status}`,
      };
    }

    console.log("[uploadMedia] Upload successful:", result.media?.id);
    return result as UploadMediaResult;
  } catch (error) {
    console.error("[uploadMedia] Error:", error);
    return {
      ok: false,
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

/**
 * Upload avatar image
 */
export async function uploadAvatar(uri: string): Promise<UploadMediaResult> {
  return uploadMedia({ uri, kind: "avatar" });
}

/**
 * Upload post image
 */
export async function uploadPostImage(uri: string): Promise<UploadMediaResult> {
  return uploadMedia({ uri, kind: "post-image" });
}

/**
 * Upload post video
 */
export async function uploadPostVideo(
  uri: string,
  durationSec: number,
): Promise<UploadMediaResult> {
  return uploadMedia({ uri, kind: "post-video", durationSec });
}

/**
 * Upload story image
 */
export async function uploadStoryImage(
  uri: string,
): Promise<UploadMediaResult> {
  return uploadMedia({ uri, kind: "story-image" });
}

/**
 * Upload story video
 */
export async function uploadStoryVideo(
  uri: string,
  durationSec: number,
): Promise<UploadMediaResult> {
  return uploadMedia({ uri, kind: "story-video", durationSec });
}

/**
 * Upload event cover image
 */
export async function uploadEventCover(
  uri: string,
): Promise<UploadMediaResult> {
  return uploadMedia({ uri, kind: "event-cover" });
}

/**
 * Upload event gallery image
 */
export async function uploadEventImage(
  uri: string,
): Promise<UploadMediaResult> {
  return uploadMedia({ uri, kind: "event-image" });
}

/**
 * Upload message image
 */
export async function uploadMessageImage(
  uri: string,
): Promise<UploadMediaResult> {
  return uploadMedia({ uri, kind: "message-image" });
}

/**
 * Upload message video
 */
export async function uploadMessageVideo(
  uri: string,
  durationSec: number,
): Promise<UploadMediaResult> {
  return uploadMedia({ uri, kind: "message-video", durationSec });
}
