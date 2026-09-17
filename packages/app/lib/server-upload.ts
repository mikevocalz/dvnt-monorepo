/**
 * Media Upload Client
 *
 * Uploads files through the media-upload Edge Function.
 * Bunny CDN credentials are NEVER exposed to the client.
 */

import * as LegacyFileSystem from "expo-file-system/legacy";
import { Platform } from "react-native";
import { getAuthToken } from "@dvnt/app/lib/auth-client";
import { supabase } from "@dvnt/app/lib/supabase/client";
import { beginUpload, settleUpload } from "@dvnt/app/lib/media/upload-watchdog-store";

import { sizeLimitForKind, uploadPercentage, withUploadTimeout } from "@dvnt/app/lib/media/upload-policy";

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
    events: "event-video",
    "event-moments": "event-moment-video",
  };

  if (isVideo) {
    return videoMap[folder] || "post-video";
  }
  return imageMap[folder] || "post-image";
}

/** Human-readable MB, no trailing ".0". */
function mb(bytes: number): string {
  const v = bytes / (1024 * 1024);
  return v >= 10 ? String(Math.round(v)) : v.toFixed(1).replace(/\.0$/, "");
}

/**
 * Shared over-cap message. Names the real numbers — "too large" with no
 * figures leaves the user re-picking the same doomed file.
 */
function tooLargeError(bytes: number, kind: string, isVideo: boolean): string {
  const limit = sizeLimitForKind(kind);
  return isVideo
    ? `That video is ${mb(bytes)}MB — the limit is ${mb(limit)}MB. Trim it shorter or pick a lower-resolution clip.`
    : `That file is ${mb(bytes)}MB — the limit is ${mb(limit)}MB.`;
}

/**
 * Get mime type from file extension
 */
function getMimeFromUri(uri: string): string {
  const ext = uri.split(/[?#]/)[0].split(".").pop()?.toLowerCase() || "";
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
/**
 * Public upload entry point. Wraps the implementation with the WS-10 × WS-11
 * durable upload-watchdog registry so a crash/kill mid-upload leaves a
 * persisted trace the background upload-watchdog job can surface for foreground
 * resume. Recording never affects the upload result (all registry calls swallow
 * their own errors). See lib/media/upload-watchdog-store.ts for why RN uploads
 * can't be resumed by the OS.
 */
export async function uploadToServer(
  uri: string,
  folder: string = "uploads",
  onProgress?: (progress: UploadProgress) => void,
  opts?: {
    blurhash?: string;
    mimeType?: string;
    width?: number | null;
    height?: number | null;
    durationSec?: number | null;
  },
): Promise<ServerUploadResult> {
  const watchId = beginUpload(uri, folder);
  try {
    const result = await uploadToServerImpl(uri, folder, onProgress, opts);
    settleUpload(watchId, result.success);
    return result;
  } catch (e) {
    settleUpload(watchId, false);
    throw e;
  }
}

async function uploadToServerImpl(
  uri: string,
  folder: string = "uploads",
  onProgress?: (progress: UploadProgress) => void,
  opts?: {
    /**
     * Compact inline fade-in placeholder (base64 WebP micro-preview, data URI)
     * generated client-side. Sent alongside the file so the media-upload edge
     * function can persist it into the historically-NULL `blurhash` column.
     */
    blurhash?: string;
    mimeType?: string;
    /**
     * Measured, never estimated. These are forwarded so the `media` row records
     * what was actually stored — production has 179 video rows and NULL
     * width/height on every one, so no surface can tell a 4K original from a
     * 360x640 re-encode.
     */
    width?: number | null;
    height?: number | null;
    durationSec?: number | null;
  },
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

    // ── Web: native FileSystem.uploadAsync doesn't exist in the browser. Fetch
    //    the blob from the (blob:/data:/http) URI and POST it to the same
    //    media-upload Edge Function as multipart FormData — identical contract
    //    (field "file" + kind/mime params), so the server side is unchanged.
    if (Platform.OS === "web") {
      try {
        const resp = await fetch(uri);
        if (!resp.ok) throw new Error(`Could not read selected media (${resp.status})`);
        const blob = await resp.blob();
        const mime = blob.type || opts?.mimeType || getMimeFromUri(uri);
        const kind = folderToKind(folder, mime);
        // Refuse over-cap BEFORE sending — see KIND_SIZE_LIMITS.
        if (blob.size > sizeLimitForKind(kind)) {
          return {
            success: false,
            url: "",
            path: "",
            filename: "",
            error: tooLargeError(blob.size, kind, mime.startsWith("video/")),
          };
        }
        const filename = `upload_${Date.now()}.${getExtension(uri, mime)}`;
        onProgress?.({ loaded: 0, total: blob.size, percentage: 0 });
        const form = new FormData();
        form.append("file", blob, filename);
        form.append("kind", kind);
        form.append("mime", mime);
        if (opts?.blurhash) form.append("blurhash", opts.blurhash);
        // Use supabase.functions.invoke — NOT a raw fetch. A raw cross-origin
        // fetch to the functions host fails with "Failed to fetch" in the
        // browser (empty apikey in the web bundle + preflight); invoke uses the
        // correctly-initialized client key + the mechanism that works for every
        // other web edge call. supabase-js sets Content-Type for FormData.
        const controller = new AbortController();
        const { data: body, error: invokeErr } =
          await withUploadTimeout(supabase.functions.invoke("media-upload", {
            body: form,
            headers: { Authorization: `Bearer ${authToken}` },
            signal: controller.signal,
          }), () => controller.abort());
        // supabase-js collapses any non-2xx into "Edge Function returned a
        // non-2xx status code" and hides the response on `.context`. The
        // function's own validation failures come back as HTTP 200 + ok:false,
        // so a non-2xx here means the function itself errored or the worker
        // died — exactly the case where the real status/body is the only clue.
        if (invokeErr) {
          const ctx = (invokeErr as { context?: unknown }).context;
          let detail = "";
          if (ctx && typeof ctx === "object" && "status" in ctx) {
            const resp = ctx as Response;
            const text = await resp.text().catch(() => "");
            detail = ` (HTTP ${resp.status}${text ? `: ${text.slice(0, 200)}` : ""})`;
          }
          console.error("[ServerUpload] invoke failed:", invokeErr.message, detail);
          return {
            success: false,
            url: "",
            path: "",
            filename: "",
            error: `${invokeErr.message}${detail}`,
          };
        }
        if (body?.ok) {
          onProgress?.({ loaded: 100, total: 100, percentage: 100 });
          return {
            success: true,
            url: body.media.url,
            path: body.media.key || "",
            filename: body.media.key?.split("/").pop() || filename,
          };
        }
        return {
          success: false,
          url: "",
          path: "",
          filename: "",
          error: body?.error || "Upload failed",
        };
      } catch (e) {
        return {
          success: false,
          url: "",
          path: "",
          filename: "",
          error: e instanceof Error ? e.message : "Web upload failed",
        };
      }
    }

    // Determine mime type and kind (mime-aware so videos get post-video, not post-image)
    const mime = opts?.mimeType || getMimeFromUri(uri);
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
    // The extension follows the real container: a .mov stays .mov. Renaming a
    // QuickTime file to .mp4 is not a conversion, and the stored object should
    // not claim to be something it is not.
    const uploadFilename = `upload_${Date.now()}.${getExtension(uri, mime)}`;
    // Refuse over-cap BEFORE sending — see KIND_SIZE_LIMITS. `size` is present
    // on the info object whenever the file exists, which the check above
    // already established.
    const localSize = (accessibleInfo as { size?: number }).size;
    if (typeof localSize === "number" && localSize > sizeLimitForKind(kind)) {
      return {
        success: false,
        url: "",
        path: "",
        filename: "",
        error: tooLargeError(localSize, kind, mime.startsWith("video/")),
      };
    }
    const filename = accessibleUri.split("/").pop() || "upload";

    onProgress?.({ loaded: 0, total: localSize || 0, percentage: 0 });

    // Video goes up as a raw binary body; images stay multipart.
    //
    // Multipart makes the function call `req.formData()`, which buffers the
    // whole file inside a 256MB isolate before anything can be checked — fine
    // for a 4MB image, fatal for a 96MB original. BINARY_CONTENT lets the
    // function pipe `req.body` straight to storage, so memory is flat in the
    // size of the file. Both transports are already understood server-side
    // (multipart at index.ts:295, raw + x-* headers at :338).
    //
    // Either way expo-file-system streams from the file path: the bytes never
    // enter JS.
    const isVideoUpload = mime.startsWith("video/");
    const uploadTask = FileSystem.createUploadTask(
      MEDIA_UPLOAD_URL,
      accessibleUri,
      isVideoUpload
        ? {
            httpMethod: "POST",
            uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
            headers: {
              Authorization: `Bearer ${authToken}`,
              apikey: SUPABASE_ANON_KEY,
              "Content-Type": mime,
              // The function sizes and limit-checks the object from this
              // before it pipes a single byte.
              "x-content-length": String(localSize ?? 0),
              "x-kind": kind,
              "x-file-name": uploadFilename,
              "x-mime": mime,
              ...(opts?.durationSec
                ? { "x-duration-sec": String(Math.round(opts.durationSec)) }
                : {}),
              // Measured dimensions, so the stored row knows what it holds.
              // Every video row in production has NULL width/height because
              // nothing ever sent them.
              ...(opts?.width ? { "x-width": String(opts.width) } : {}),
              ...(opts?.height ? { "x-height": String(opts.height) } : {}),
              ...(opts?.blurhash ? { "x-blurhash": opts.blurhash } : {}),
            },
          }
        : {
        httpMethod: "POST",
        uploadType: FileSystem.FileSystemUploadType.MULTIPART,
        fieldName: "file",
        mimeType: mime,
        parameters: {
          kind,
          mime,
          ...(opts?.blurhash ? { blurhash: opts.blurhash } : {}),
          ...(opts?.durationSec
            ? { durationSec: String(Math.round(opts.durationSec)) }
            : {}),
          ...(opts?.width ? { width: String(opts.width) } : {}),
          ...(opts?.height ? { height: String(opts.height) } : {}),
        },
        headers: {
          Authorization: `Bearer ${authToken}`,
          apikey: SUPABASE_ANON_KEY,
        },
      },
      ({ totalBytesSent, totalBytesExpectedToSend }) => onProgress?.({
        loaded: totalBytesSent,
        total: totalBytesExpectedToSend,
        percentage: uploadPercentage(totalBytesSent, totalBytesExpectedToSend),
      }),
    );
    const uploadResult = await withUploadTimeout(uploadTask.uploadAsync(), () => uploadTask.cancelAsync());
    if (!uploadResult) throw new Error("Upload cancelled. Please try again.");

    let body: { ok?: boolean; error?: string; media?: { url: string; key?: string } };
    try { body = JSON.parse(uploadResult.body); }
    catch { throw new Error(`Upload failed (HTTP ${uploadResult.status}). Please try again.`); }

    if (uploadResult.status === 200 && body.ok && body.media?.url) {
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
