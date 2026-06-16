/**
 * Media Upload Client
 *
 * Uploads files through the media-upload Edge Function.
 * Bunny CDN credentials are NEVER exposed to the client.
 */

import * as LegacyFileSystem from "expo-file-system/legacy";
import { getAuthToken } from "@/lib/auth-client";

const FileSystem = LegacyFileSystem;

const _rawSupabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_URL =
  typeof _rawSupabaseUrl === "string" && _rawSupabaseUrl.startsWith("https://")
    ? _rawSupabaseUrl
    : "https://npfjanxturvmjyevoyfo.supabase.co";
const MEDIA_UPLOAD_URL = `${SUPABASE_URL}/functions/v1/media-upload`;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || "";

export interface UploadProgress {
  loaded: number;
  total: number;
  percentage: number;
}

export interface ServerUploadResult {
  success: boolean;
  url: string;
  path: string;
  filename: string;
  error?: string;
}

function sanitizeExtension(extension?: string | null): string {
  if (!extension) return "jpg";

  const normalized = extension.replace(/^\./, "").toLowerCase();
  return /^[a-z0-9]+$/i.test(normalized) ? normalized : "jpg";
}

function getExtension(uri: string, mimeType?: string): string {
  const uriMatch = uri.match(/\.([a-z0-9]+)(?:\?|$)/i);
  if (uriMatch) {
    return sanitizeExtension(uriMatch[1]);
  }

  const mimeMap: Record<string, string> = {
    "image/heic": "heic",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "video/mp4": "mp4",
    "video/mov": "mov",
    "video/quicktime": "mov",
  };

  return sanitizeExtension(mimeMap[mimeType || ""]);
}

/**
 * Map folder name + mime type to media-upload edge function "kind" parameter.
 */
function folderToKind(folder: string, mime?: string): string {
  const isVideo = mime?.startsWith("video/");

  // Check for thumbnail subfolders
  if (folder.includes("thumbnails")) return "post-image";

  const imageMap: Record<string, string> = {
    avatars: "avatar",
    posts: "post-image",
    stories: "story-image",
    events: "event-image",
    "events/covers": "event-cover",
    chat: "message-image",
    uploads: "post-image",
    "event-moments": "event-moment-photo",
  };

  const videoMap: Record<string, string> = {
    posts: "post-video",
    stories: "story-video",
    chat: "message-video",
    uploads: "post-video",
    "event-moments": "event-moment-video",
  };

  if (isVideo) {
    return videoMap[folder] || "post-video";
  }
  return imageMap[folder] || "post-image";
}

/**
 * Get mime type from file extension
 */
function getMimeFromUri(uri: string): string {
  const ext = uri.split(".").pop()?.toLowerCase() || "";
  const mimeMap: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    gif: "image/gif",
    mp4: "video/mp4",
    mov: "video/quicktime",
  };
  return mimeMap[ext] || "image/jpeg";
}

/**
 * Ensure file is accessible — copy ph:// or content:// URIs to cache
 */
async function ensureFileAccessible(
  uri: string,
  mimeType?: string,
): Promise<string> {
  if (uri.startsWith("file://")) {
    const info = await FileSystem.getInfoAsync(uri);
    if (info.exists) return uri;
    throw new Error("Selected file is no longer available");
  }

  if (
    uri.startsWith("ph://") ||
    uri.startsWith("content://") ||
    uri.startsWith("assets-library://")
  ) {
    const ext = getExtension(uri, mimeType);
    const cacheUri = `${FileSystem.cacheDirectory}upload_${Date.now()}.${ext}`;

    try {
      await FileSystem.copyAsync({ from: uri, to: cacheUri });
    } catch (error) {
      console.warn(
        "[ServerUpload] Copy to cache failed, attempting original URI fallback:",
        error,
      );

      const originalInfo = await FileSystem.getInfoAsync(uri).catch(() => null);
      if (originalInfo?.exists) {
        return uri;
      }

      throw new Error(
        "Selected media is no longer available. Please remove it and choose it again.",
      );
    }

    const copiedInfo = await FileSystem.getInfoAsync(cacheUri);
    if (!copiedInfo.exists) {
      throw new Error("Failed to prepare selected media for upload");
    }

    return cacheUri;
  }

  return uri;
}

/**
 * Upload a file via the media-upload Edge Function.
 * Bunny credentials stay server-side.
 */
export async function uploadToServer(
  uri: string,
  folder: string = "uploads",
  onProgress?: (progress: UploadProgress) => void,
): Promise<ServerUploadResult> {
  console.log("[ServerUpload] Starting upload via Edge Function:", {
    uri: uri.substring(0, 60),
    folder,
  });

  try {
    // Get auth token
    const authToken = await getAuthToken();
    if (!authToken) {
      return {
        success: false,
        url: "",
        path: "",
        filename: "",
        error: "Not authenticated — cannot upload",
      };
    }

    // Determine mime type and kind (mime-aware so videos get post-video, not post-image)
    const mime = getMimeFromUri(uri);
    const accessibleUri = await ensureFileAccessible(uri, mime);
    const accessibleInfo = await FileSystem.getInfoAsync(accessibleUri).catch(
      () => null,
    );
    if (!accessibleInfo?.exists) {
      throw new Error(
        "Selected media is no longer available. Please choose it again.",
      );
    }
    const kind = folderToKind(folder, mime);
    const filename = accessibleUri.split("/").pop() || "upload";

    onProgress?.({ loaded: 0, total: 100, percentage: 10 });

    // Upload via FileSystem.uploadAsync (multipart form)
    // Pass mimeType explicitly — Expo's multipart upload may default to
    // application/octet-stream if the extension isn't detected by the OS,
    // which would fail the edge function's mime validation.
    const uploadResult = await FileSystem.uploadAsync(
      MEDIA_UPLOAD_URL,
      accessibleUri,
      {
        httpMethod: "POST",
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: "file",
        mimeType: mime,
        parameters: {
          kind,
          mime,
        },
        headers: {
          Authorization: `Bearer ${authToken}`,
          apikey: SUPABASE_ANON_KEY,
        },
      },
    );

    onProgress?.({ loaded: 80, total: 100, percentage: 80 });

    const body = JSON.parse(uploadResult.body);

    if (uploadResult.status === 200 && body.ok) {
      onProgress?.({ loaded: 100, total: 100, percentage: 100 });
      console.log("[ServerUpload] Success:", body.media?.url);
      return {
        success: true,
        url: body.media.url,
        path: body.media.key || "",
        filename: body.media.key?.split("/").pop() || "",
      };
    }

    const errorMsg =
      body.error || `Upload failed (status ${uploadResult.status})`;
    console.error("[ServerUpload] Failed:", errorMsg);
    return {
      success: false,
      url: "",
      path: "",
      filename: "",
      error: errorMsg,
    };
  } catch (error) {
    console.error("[ServerUpload] Error:", error);
    return {
      success: false,
      url: "",
      path: "",
      filename: "",
      error: error instanceof Error ? error.message : "Upload failed",
    };
  }
}

/**
 * Upload multiple files
 */
export async function uploadMultipleToServer(
  files: Array<{ uri: string; type: "image" | "video" }>,
  folder: string = "uploads",
  onProgress?: (progress: UploadProgress) => void,
): Promise<
  Array<{
    type: "image" | "video";
    url: string;
    success: boolean;
    error?: string;
  }>
> {
  const results: Array<{
    type: "image" | "video";
    url: string;
    success: boolean;
    error?: string;
  }> = [];
  const totalFiles = files.length;
  let completedFiles = 0;

  for (const file of files) {
    const result = await uploadToServer(file.uri, folder, (fileProgress) => {
      if (onProgress) {
        const fileContribution = fileProgress.percentage / totalFiles;
        const completedContribution = (completedFiles / totalFiles) * 100;
        onProgress({
          loaded: completedFiles + fileProgress.percentage / 100,
          total: totalFiles,
          percentage: Math.round(completedContribution + fileContribution),
        });
      }
    });

    results.push({
      type: file.type,
      url: result.url,
      success: result.success,
      error: result.error,
    });

    completedFiles++;
  }

  return results;
}

/**
 * Delete files from Bunny CDN via the media-upload Edge Function.
 * Bunny credentials stay server-side.
 *
 * @param keys - Array of Bunny storage paths (e.g. "post-image/userId/2026/03/uuid.jpg")
 */
export async function deleteFromServer(
  keys: string[],
): Promise<{ ok: boolean; results: { key: string; deleted: boolean }[] }> {
  try {
    const authToken = await getAuthToken();
    if (!authToken) {
      console.error("[ServerDelete] Not authenticated");
      return {
        ok: false,
        results: keys.map((key) => ({ key, deleted: false })),
      };
    }

    const resp = await fetch(MEDIA_UPLOAD_URL, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${authToken}`,
        apikey: SUPABASE_ANON_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ keys }),
    });

    const body = await resp.json();
    if (body.ok) {
      console.log(
        "[ServerDelete] Success:",
        body.results?.length,
        "keys processed",
      );
      return { ok: true, results: body.results || [] };
    }

    console.error("[ServerDelete] Failed:", body.error);
    return { ok: false, results: keys.map((key) => ({ key, deleted: false })) };
  } catch (error) {
    console.error("[ServerDelete] Error:", error);
    return { ok: false, results: keys.map((key) => ({ key, deleted: false })) };
  }
}

/**
 * Check if upload is available
 */
export async function checkUploadConfig(): Promise<{
  configured: boolean;
  cdnUrl: string;
  maxSizeMB: number;
}> {
  const cdnUrl =
    process.env.EXPO_PUBLIC_BUNNY_CDN_URL || "https://dvnt.b-cdn.net";
  return {
    configured: true,
    cdnUrl,
    maxSizeMB: 25,
  };
}
