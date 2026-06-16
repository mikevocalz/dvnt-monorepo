/**
 * Media Kind Detection
 * Determines the correct MediaKind from picker asset metadata.
 * Called in the picker hook BEFORE any processing — no destructive transforms.
 */

import type { MediaKind } from "./types";

const GIF_MIME = "image/gif";
const GIF_EXTENSIONS = [".gif"];

const VIDEO_MIMES = ["video/mp4", "video/quicktime", "video/x-m4v", "video/webm", "video/avi"];
const VIDEO_EXTENSIONS = [".mp4", ".mov", ".m4v", ".webm", ".avi"];

/**
 * Derive MediaKind from a picker asset.
 * Priority: explicit type field → MIME type → filename extension.
 *
 * @param pickerType  - asset.type from expo-image-picker ("image"|"video"|"livePhoto"|"pairedVideo")
 * @param mimeType    - asset.mimeType from expo-image-picker (preferred)
 * @param fileName    - asset.fileName for extension-based fallback
 */
export function detectMediaKind(
  pickerType: "image" | "video" | "livePhoto" | "pairedVideo" | null | undefined,
  mimeType?: string | null,
  fileName?: string | null,
): MediaKind {
  // Live Photo types come from expo-image-picker explicitly
  if (pickerType === "livePhoto") return "livePhoto";
  // pairedVideo is the video side of a live photo — caller handles it separately
  if (pickerType === "pairedVideo") return "video";

  // Normalise
  const mime = mimeType?.toLowerCase() ?? "";
  const ext = getExtension(fileName ?? "");

  // GIF detection (MIME first, then extension)
  if (mime === GIF_MIME || GIF_EXTENSIONS.includes(ext)) return "gif";

  // Video detection
  if (pickerType === "video") return "video";
  if (VIDEO_MIMES.includes(mime) || VIDEO_EXTENSIONS.includes(ext)) return "video";

  // Default: image
  return "image";
}

/**
 * Returns true if this kind should bypass compression/manipulation.
 * GIFs must never pass through expo-image-manipulator — it destroys frames.
 * Live Photos must never be run through image compression — they are opaque.
 */
export function shouldSkipCompression(kind: MediaKind): boolean {
  return kind === "gif" || kind === "livePhoto";
}

/**
 * Returns true if this is a static-image kind (can be rendered with expo-image without video player).
 */
export function isImageLike(kind: MediaKind): boolean {
  return kind === "image" || kind === "gif" || kind === "livePhoto";
}

/**
 * Returns an appropriate content-type header string for uploads.
 */
export function mimeTypeForKind(kind: MediaKind, originalMime?: string | null): string {
  if (kind === "gif") return GIF_MIME;
  if (kind === "video") return originalMime ?? "video/mp4";
  if (kind === "livePhoto") return originalMime ?? "image/jpeg";
  return originalMime ?? "image/jpeg";
}

// ── Private helpers ────────────────────────────────────────────────────────

function getExtension(fileName: string): string {
  const dotIdx = fileName.lastIndexOf(".");
  if (dotIdx === -1) return "";
  return fileName.slice(dotIdx).toLowerCase();
}
