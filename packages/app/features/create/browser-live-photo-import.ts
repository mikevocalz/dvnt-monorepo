import type { MediaAsset } from "../../lib/hooks/use-media-picker";
import { sizeLimitForKind } from "../../lib/media/upload-policy.ts";
import { validateVideoPick } from "../../lib/media/video-pick-policy.ts";

export const MAX_BROWSER_POST_MEDIA = 10;
export const LIVE_PHOTO_STILL_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic";
export const LIVE_PHOTO_VIDEO_ACCEPT = "video/mp4,video/quicktime,video/mov,.mp4,.mov,.m4v";

const STILL_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic"];
const EXTENSION_MIMES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime",
};

function fileMime(file: File): string {
  return file.type.trim().toLowerCase() || EXTENSION_MIMES[file.name.split(".").pop()?.toLowerCase() ?? ""] || "";
}

/** Adding MIME metadata never changes or re-encodes the original file bytes. */
function typedOriginal(file: File, mime: string): Blob {
  return file.type === mime ? file : file.slice(0, file.size, mime);
}

type Failure = { ok: false; title: string; message: string };
type PairResult = { ok: true; asset: MediaAsset } | Failure;
export type PairDependencies = {
  readDuration?: (file: File) => Promise<number | null>;
  createObjectURL?: (blob: Blob) => string;
  revokeObjectURL?: (url: string) => void;
};

export function validateLivePhotoFiles(still: File | null, motion: File | null): Failure | null {
  if (!still || !motion) {
    return { ok: false, title: "Choose both files", message: "Choose one still photo and its matching MOV or MP4 motion file." };
  }
  if (!STILL_MIMES.includes(fileMime(still))) {
    return { ok: false, title: "Unsupported still photo", message: "Choose a JPEG, PNG, WebP or HEIC still photo, not a video or animated GIF." };
  }
  if (still.size === 0 || motion.size === 0) {
    return { ok: false, title: "Empty file", message: "One of these files is empty. Choose the original photo and motion files again." };
  }
  const limit = sizeLimitForKind("post-image");
  if (still.size > limit) {
    return { ok: false, title: "Photo too large", message: `Live Photo stills can be up to ${Math.round(limit / (1024 * 1024))}MB.` };
  }
  const check = validateVideoPick({ kind: "post-video", mimeType: fileMime(motion), fileName: motion.name, sizeBytes: motion.size });
  return check.ok ? null : check;
}

/** Metadata alone does not prove the browser can decode an Apple HEVC clip. */
export function readPlayableLivePhotoDuration(file: File): Promise<number | null> {
  return new Promise(resolve => {
    if (typeof document === "undefined") return resolve(null);
    const url = URL.createObjectURL(typedOriginal(file, fileMime(file)));
    const video = document.createElement("video");
    let settled = false;
    let timeout: ReturnType<typeof setTimeout>;
    const done = (duration: number | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      video.onloadeddata = null; video.oncanplay = null; video.onerror = null;
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
      resolve(duration);
    };
    const ready = () => {
      if (video.readyState >= 2 && Number.isFinite(video.duration) && video.duration > 0) done(video.duration);
    };
    video.onloadeddata = ready; video.oncanplay = ready;
    video.onerror = () => done(null);
    timeout = setTimeout(() => done(null), 10_000);
    video.preload = "auto"; video.muted = true; video.playsInline = true;
    video.src = url;
  });
}

/** The user supplies both halves explicitly. File names are NEVER used to pair assets. */
export async function createBrowserLivePhotoAsset(
  still: File,
  motion: File,
  dependencies: PairDependencies = {},
): Promise<PairResult> {
  const invalid = validateLivePhotoFiles(still, motion);
  if (invalid) return invalid;
  const duration = await (dependencies.readDuration ?? readPlayableLivePhotoDuration)(motion);
  if (duration == null || !Number.isFinite(duration) || duration <= 0) {
    return { ok: false, title: "Motion cannot play", message: "This browser could not play the motion file. Choose a compatible MOV or MP4 from this Live Photo, try a compatible browser, or upload with the iPhone app." };
  }
  const check = validateVideoPick({
    kind: "post-video", mimeType: fileMime(motion), fileName: motion.name,
    sizeBytes: motion.size, durationSec: duration,
  });
  if (!check.ok) return check;
  const createURL = dependencies.createObjectURL ?? URL.createObjectURL.bind(URL);
  const revokeURL = dependencies.revokeObjectURL ?? URL.revokeObjectURL.bind(URL);
  const uri = createURL(typedOriginal(still, fileMime(still)));
  try {
    const pairedVideoUri = createURL(typedOriginal(motion, fileMime(motion)));
    return { ok: true, asset: {
      id: `live-photo-${crypto.randomUUID()}`,
      uri, originalUri: uri, pairedVideoUri, type: "image", kind: "livePhoto",
      mimeType: fileMime(still), fileName: still.name, fileSize: still.size,
      ...(duration != null ? { duration } : {}),
    } };
  } catch (error) {
    revokeURL(uri);
    throw error;
  }
}

export function releaseBrowserMediaAsset(asset: MediaAsset): void {
  for (const uri of new Set([asset.uri, asset.originalUri, asset.pairedVideoUri])) {
    if (uri?.startsWith("blob:")) URL.revokeObjectURL(uri);
  }
}

export interface BrowserMediaSelection {
  selectedMedia: MediaAsset[];
  postKind: string;
  /** Reset creates new text slides even when the media draft was already empty. */
  textSlides: readonly unknown[];
  setSelectedMedia: (media: MediaAsset[]) => void;
}

/** Atomic synchronous commit after async reads; never append into a replaced draft. */
export function captureBrowserMediaCommit(
  getState: () => BrowserMediaSelection,
  isCurrent: () => boolean = () => true,
): (assets: MediaAsset[]) => boolean {
  const draft = getState();
  return (assets) => {
    const current = getState();
    if (!isCurrent() || current.postKind !== "media" ||
      current.selectedMedia !== draft.selectedMedia || current.textSlides !== draft.textSlides ||
      current.selectedMedia.length + assets.length > MAX_BROWSER_POST_MEDIA) return false;
    current.setSelectedMedia([...current.selectedMedia, ...assets]);
    return true;
  };
}
