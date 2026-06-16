import * as LegacyFileSystem from "expo-file-system/legacy";

const FileSystem = LegacyFileSystem;

const REMOTE_MEDIA_URI_PATTERN = /^https?:\/\//i;
const LOCAL_MEDIA_URI_PATTERN = /^(file|content|ph|assets-library):\/\//i;

const MIME_EXTENSION_MAP: Record<string, string> = {
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "video/mov": "mov",
  "video/quicktime": "mov",
};

function sanitizeExtension(extension?: string | null): string {
  if (!extension) return "jpg";

  const normalized = extension.replace(/^\./, "").toLowerCase();
  return /^[a-z0-9]+$/i.test(normalized) ? normalized : "jpg";
}

function guessExtension(source: string, mimeType?: string): string {
  const sourceMatch = source.match(/\.([a-z0-9]+)(?:\?|$)/i);
  if (sourceMatch) {
    return sanitizeExtension(sourceMatch[1]);
  }

  return sanitizeExtension(MIME_EXTENSION_MAP[mimeType || ""]);
}

export function isRemoteMediaUri(uri: string): boolean {
  return REMOTE_MEDIA_URI_PATTERN.test(uri);
}

export function isLocalMediaUri(uri: string): boolean {
  return LOCAL_MEDIA_URI_PATTERN.test(uri);
}

export interface PersistLocalMediaSelectionOptions {
  scope?: string;
  fileName?: string;
  mimeType?: string;
}

export async function persistLocalMediaSelection(
  uri: string,
  options: PersistLocalMediaSelectionOptions = {},
): Promise<string> {
  if (!uri) {
    throw new Error("Cannot persist an empty media URI");
  }

  if (isRemoteMediaUri(uri)) {
    return uri;
  }

  const rootDirectory = FileSystem.documentDirectory ?? FileSystem.cacheDirectory;
  if (!rootDirectory) {
    throw new Error("Local media storage is unavailable");
  }

  const scope = options.scope?.replace(/^\/+|\/+$/g, "") || "draft-media";
  const targetDirectory = `${rootDirectory}${scope}/`;

  if (uri.startsWith(targetDirectory)) {
    return uri;
  }

  const sourceInfo = await FileSystem.getInfoAsync(uri).catch(() => null);
  if (!sourceInfo?.exists) {
    throw new Error(
      "Selected media is no longer available. Please remove it and add it again.",
    );
  }

  await FileSystem.makeDirectoryAsync(targetDirectory, { intermediates: true });

  const extension = guessExtension(options.fileName || uri, options.mimeType);
  const fileName = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`;
  const targetUri = `${targetDirectory}${fileName}`;

  try {
    await FileSystem.copyAsync({
      from: uri,
      to: targetUri,
    });
  } catch (error) {
    console.warn(
      "[persistLocalMediaSelection] Copy failed, falling back to original URI:",
      error,
    );

    const fallbackInfo = await FileSystem.getInfoAsync(uri).catch(() => null);
    if (fallbackInfo?.exists) {
      return uri;
    }

    throw new Error(
      "Selected media is no longer available. Please remove it and add it again.",
    );
  }

  const info = await FileSystem.getInfoAsync(targetUri);
  if (!info.exists) {
    throw new Error("Failed to persist selected media");
  }

  return targetUri;
}
