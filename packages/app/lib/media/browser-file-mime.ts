/**
 * Browsers report "" or a generic binary type when the OS has no registration
 * for an extension: HEIC on Windows and Android Chrome, MOV from some pickers.
 * Trusting that value refused real photos and sent `application/octet-stream`
 * to media-upload, which only accepts named image and video types.
 */
const GENERIC_MIMES = new Set(["", "application/octet-stream", "binary/octet-stream"]);

export const BROWSER_EXTENSION_MIMES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", gif: "image/gif",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime",
};

export function isGenericMime(mime: string | null | undefined): boolean {
  return GENERIC_MIMES.has((mime ?? "").trim().toLowerCase());
}

/** The OS-reported type, or the extension's type when the OS reported nothing useful. */
export function browserFileMime(file: File, extensionMimes: Record<string, string> = BROWSER_EXTENSION_MIMES): string {
  const reported = file.type.trim().toLowerCase();
  if (!GENERIC_MIMES.has(reported)) return reported;
  return extensionMimes[file.name.split(".").pop()?.toLowerCase() ?? ""] || "";
}

/** Same bytes, with the resolved type, so blob URLs and uploads carry it. */
export function typedBrowserFile(file: File): Blob {
  const mime = browserFileMime(file);
  return !mime || file.type === mime ? file : file.slice(0, file.size, mime);
}
