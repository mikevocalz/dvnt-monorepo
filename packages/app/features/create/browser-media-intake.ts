import type { MediaAsset } from "../../lib/hooks/use-media-picker";
import { sizeLimitForKind } from "../../lib/media/upload-policy.ts";
import { validateVideoPick } from "../../lib/media/video-pick-policy.ts";
import { browserFileMime } from "../../lib/media/browser-file-mime.ts";
import { readAppleContentId } from "../../lib/media/apple-content-id.ts";
import { locateMotionPhotoVideo } from "../../lib/media/motion-photo.ts";
import {
  MAX_BROWSER_POST_MEDIA,
  readPlayableLivePhotoSource,
  readPlayableLivePhotoDuration,
  type BrowserMediaSelection,
} from "./browser-live-photo-import.ts";

// Ten Live Photos can arrive as twenty unassociated originals. Review can
// temporarily hold these, but the publish boundary still permits ten items.
export const MAX_BROWSER_REVIEW_FILES = MAX_BROWSER_POST_MEDIA * 2;
export const BROWSER_MEDIA_ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/gif,video/mp4,video/quicktime,video/mov,.jpg,.jpeg,.png,.webp,.heic,.gif,.mov,.mp4,.m4v";
const IMAGE_MIMES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/gif"];
const EXTENSION_MIMES: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heic: "image/heic", gif: "image/gif",
  mp4: "video/mp4", m4v: "video/mp4", mov: "video/quicktime",
};
const fileMime = (file: File) => browserFileMime(file, EXTENSION_MIMES);

export interface BrowserPairedMedia extends MediaAsset {
  /** Reversible: the pair card can be split back into its two originals. */
  browserPair?: { still: MediaAsset; motion: MediaAsset };
  /** Apple's Live Photo content identifier, read from the file's own metadata. */
  appleContentId?: string;
}

type MotionPhoto = { still: Blob; motion: File; duration: number };
// Largest file that can still hold a postable still plus a postable clip.
const MAX_MOTION_PHOTO_BYTES = sizeLimitForKind("post-image") + sizeLimitForKind("post-video");
const MOTION_PHOTO_MIMES = ["image/jpeg", "image/heic", "image/heif"];

/** An Android Motion Photo's embedded MP4, split from its still. Null means "post it as a plain photo". */
async function readMotionPhoto(file: File, mime: string, readDuration: (file: File) => Promise<number | null>): Promise<MotionPhoto | null> {
  try {
    const found = await locateMotionPhotoVideo(file);
    if (!found) return null;
    const motion = new File([file.slice(found.videoStart, found.videoEnd)], `${file.name.replace(/\.[^.]*$/, "")}.mp4`, { type: "video/mp4" });
    const input = { kind: "post-video", mimeType: motion.type, fileName: motion.name, sizeBytes: motion.size };
    if (!validateVideoPick(input).ok) return null;
    const duration = await readDuration(motion);
    if (duration == null || !Number.isFinite(duration) || duration <= 0 || !validateVideoPick({ ...input, durationSec: duration }).ok) return null;
    return { still: file.slice(0, found.stillEnd, mime), motion, duration };
  } catch {
    return null;
  }
}

export async function readBrowserMediaFiles(
  files: readonly File[],
  options: {
    readDuration?: (file: File) => Promise<number | null>;
    readContentId?: (file: Blob, kind: "still" | "motion") => Promise<string | null>;
    isCurrent?: () => boolean;
  } = {},
): Promise<{ assets: BrowserPairedMedia[]; errors: string[] }> {
  const assets: BrowserPairedMedia[] = [];
  const errors: string[] = [];
  try {
    for (const file of files) {
      if (options.isCurrent && !options.isCurrent()) break;
      const mime = fileMime(file);
      const video = mime.startsWith("video/");
      if (!video && !IMAGE_MIMES.includes(mime)) {
        errors.push(`${file.name}: use JPEG, PNG, WebP, HEIC, GIF, MOV or MP4.`); continue;
      }
      if (file.size === 0) { errors.push(`${file.name}: this file is empty.`); continue; }
      let duration: number | null = null;
      let motionPhoto: MotionPhoto | null = null;
      if (video) {
        const formatCheck = validateVideoPick({ kind: "post-video", mimeType: mime, fileName: file.name, sizeBytes: file.size });
        if (!formatCheck.ok) { errors.push(`${file.name}: ${formatCheck.message}`); continue; }
        duration = await (options.readDuration ?? readPlayableLivePhotoDuration)(file);
        if (options.isCurrent && !options.isCurrent()) break;
        if (duration == null || !Number.isFinite(duration) || duration <= 0) {
          errors.push(`${file.name}: this browser could not play the motion. Choose a compatible MOV or MP4, or try a compatible browser.`); continue;
        }
        const check = validateVideoPick({ kind: "post-video", mimeType: mime, fileName: file.name, sizeBytes: file.size, durationSec: duration });
        if (!check.ok) { errors.push(`${file.name}: ${check.message}`); continue; }
      } else {
        if (MOTION_PHOTO_MIMES.includes(mime) && file.size <= MAX_MOTION_PHOTO_BYTES) {
          motionPhoto = await readMotionPhoto(file, mime, options.readDuration ?? readPlayableLivePhotoDuration);
          if (options.isCurrent && !options.isCurrent()) break;
        }
        // The photo limit applies to the still a Motion Photo uploads, not to the still plus its clip.
        if ((motionPhoto?.still.size ?? file.size) > sizeLimitForKind("post-image")) {
          errors.push(`${file.name}: photos can be up to ${Math.round(sizeLimitForKind("post-image") / (1024 * 1024))}MB.`); continue;
        }
      }
      const contentId = mime === "image/gif" ? null
        : await (options.readContentId ?? readAppleContentId)(file, video ? "motion" : "still");
      if (options.isCurrent && !options.isCurrent()) break;
      if (motionPhoto) {
        // One file holds both halves, so this pair is read from the file's own bytes, never by name.
        const uri = URL.createObjectURL(motionPhoto.still);
        let motionUri: string;
        try { motionUri = URL.createObjectURL(motionPhoto.motion); } catch (error) { URL.revokeObjectURL(uri); throw error; }
        const still: BrowserPairedMedia = {
          ...(contentId ? { appleContentId: contentId } : {}),
          id: `media-${crypto.randomUUID()}`, uri, originalUri: uri, type: "image", kind: "image",
          mimeType: mime, fileName: file.name, fileSize: motionPhoto.still.size,
        };
        assets.push(pairOf(still, {
          id: `media-${crypto.randomUUID()}`, uri: motionUri, originalUri: motionUri, type: "video", kind: "video",
          mimeType: motionPhoto.motion.type, fileName: motionPhoto.motion.name, fileSize: motionPhoto.motion.size, duration: motionPhoto.duration,
        }));
        continue;
      }
      // MIME-only wrapping preserves every original byte. Never pair by name.
      const uri = URL.createObjectURL(file.type === mime ? file : file.slice(0, file.size, mime));
      assets.push({
        ...(contentId ? { appleContentId: contentId } : {}),
        id: `media-${crypto.randomUUID()}`, uri, originalUri: uri,
        type: video ? "video" : "image", kind: video ? "video" : mime === "image/gif" ? "gif" : "image",
        mimeType: mime, fileName: file.name, fileSize: file.size,
        ...(duration != null ? { duration } : {}),
      });
    }
    return { assets, errors };
  } catch (error) {
    releaseUnselectedBrowserMedia(assets, []);
    throw error;
  }
}

type AssociationResult = { ok: true; media: MediaAsset[] } | { ok: false; message: string };

/** Only an explicit inline selector choice associates two supplied originals. */
export async function associateBrowserMedia(
  selected: readonly MediaAsset[], stillId: string, motionId: string,
  readDuration: (uri: string) => Promise<number | null> = readPlayableLivePhotoSource,
): Promise<AssociationResult> {
  const still = selected.find(item => item.id === stillId);
  const motion = selected.find(item => item.id === motionId);
  if (!still || still.kind !== "image" || !motion || motion.type !== "video" || motion.kind !== "video") {
    return { ok: false, message: "Choose a still photo and a separate motion clip from your selected files." };
  }
  const duration = await readDuration(motion.uri);
  if (duration == null || !Number.isFinite(duration) || duration <= 0) {
    return { ok: false, message: "This browser could not play that motion clip. Choose a compatible MOV or MP4, or retry the selection. The files remain separate." };
  }
  const check = validateVideoPick({ kind: "post-video", mimeType: motion.mimeType, fileName: motion.fileName, sizeBytes: motion.fileSize, durationSec: duration });
  if (!check.ok) return { ok: false, message: check.message };
  const pair: BrowserPairedMedia = {
    ...still, type: "image", kind: "livePhoto", pairedVideoUri: motion.uri, duration,
    browserPair: { still, motion },
  };
  return { ok: true, media: selected.filter(item => item.id !== motionId).map(item => item.id === stillId ? pair : item) };
}

type Buckets = Map<string, { stills: BrowserPairedMedia[]; motions: BrowserPairedMedia[] }>;
function bucket(media: readonly BrowserPairedMedia[]): Buckets {
  const out: Buckets = new Map();
  for (const item of media) {
    if (!item.appleContentId || item.browserPair) continue;
    const entry = out.get(item.appleContentId) ?? { stills: [], motions: [] };
    if (item.kind === "image") entry.stills.push(item);
    else if (item.type === "video" && item.kind === "video") entry.motions.push(item);
    out.set(item.appleContentId, entry);
  }
  return out;
}
const pairOf = (still: BrowserPairedMedia, motion: BrowserPairedMedia): BrowserPairedMedia => ({
  ...still, type: "image", kind: "livePhoto", pairedVideoUri: motion.uri, duration: motion.duration,
  browserPair: { still, motion },
});

/**
 * Merges newly read files into the draft, pairing a still and a motion clip
 * only when both carry the same Apple content identifier, one of each.
 * A complete incoming pair replaces loose halves of the same photo already in
 * the draft (the still a Photos sidebar pick sends on its own), and is dropped
 * if the draft already holds that Live Photo. Anything ambiguous stays separate.
 * `removed` lists draft items replaced here; their URLs are the caller's to release.
 */
export function mergeByAppleContentId(
  existing: readonly BrowserPairedMedia[], incoming: readonly BrowserPairedMedia[],
): { media: BrowserPairedMedia[]; removed: BrowserPairedMedia[] } {
  const heldPairs = new Set(existing.flatMap(item => item.browserPair && item.appleContentId ? [item.appleContentId] : []));
  const draftLoose = bucket(existing);
  const pairs = new Map<string, BrowserPairedMedia>();
  const drop = new Set<string>();
  for (const [id, { stills, motions }] of bucket(incoming)) {
    const loose = draftLoose.get(id) ?? { stills: [], motions: [] };
    if (stills.length === 1 && motions.length === 1) {
      if (heldPairs.has(id)) { drop.add(stills[0].id); drop.add(motions[0].id); continue; }
      pairs.set(stills[0].id, pairOf(stills[0], motions[0])); drop.add(motions[0].id);
      for (const item of [...loose.stills, ...loose.motions]) drop.add(item.id);
    } else if (stills.length + motions.length === 1 && loose.stills.length + loose.motions.length === 1) {
      // One half arrives now, the other is already waiting in the draft.
      const still = stills[0] ?? loose.stills[0], motion = motions[0] ?? loose.motions[0];
      if (!still || !motion) continue;
      pairs.set(still.id, pairOf(still, motion)); drop.add(motion.id);
    }
  }
  const all = [...existing, ...incoming];
  return {
    media: all.filter(item => !drop.has(item.id)).map(item => pairs.get(item.id) ?? item),
    removed: existing.filter(item => drop.has(item.id) && !pairs.has(item.id)),
  };
}

export function separateBrowserMedia(selected: readonly MediaAsset[], id: string): AssociationResult {
  const pair = selected.find(item => item.id === id) as BrowserPairedMedia | undefined;
  if (!pair?.browserPair) return { ok: false, message: "This pair cannot be separated here. Remove it and choose its original files again." };
  if (selected.length >= MAX_BROWSER_POST_MEDIA) return { ok: false, message: `Remove another item before separating this pair. A post can contain up to ${MAX_BROWSER_POST_MEDIA} items.` };
  // A split is the user's choice; dropping the identifier keeps later picks from re-pairing them.
  const unpaired = ({ appleContentId: _, ...item }: BrowserPairedMedia): MediaAsset => item;
  return { ok: true, media: selected.flatMap(item => item.id === id ? [unpaired(pair.browserPair!.still), unpaired(pair.browserPair!.motion)] : [item]) };
}

function assetURLs(asset: BrowserPairedMedia): string[] {
  return [asset.uri, asset.originalUri, asset.pairedVideoUri, ...(asset.browserPair ? [...assetURLs(asset.browserPair.still), ...assetURLs(asset.browserPair.motion)] : [])].filter((uri): uri is string => Boolean(uri));
}

/** Shared URLs transfer between paired/separate cards; revoke only final owners. */
export function releaseUnselectedBrowserMedia(removed: readonly MediaAsset[], kept: readonly MediaAsset[]): void {
  const retained = new Set(kept.flatMap(assetURLs));
  for (const uri of new Set(removed.flatMap(assetURLs))) {
    if (uri.startsWith("blob:") && !retained.has(uri)) URL.revokeObjectURL(uri);
  }
}

export function captureBrowserMediaReplacement(
  getState: () => BrowserMediaSelection,
  isCurrent: () => boolean = () => true,
): (media: MediaAsset[]) => boolean {
  const draft = getState();
  return media => {
    const current = getState();
    if (!isCurrent() || current.postKind !== "media" || current.selectedMedia !== draft.selectedMedia ||
      current.textSlides !== draft.textSlides || media.length > MAX_BROWSER_REVIEW_FILES) return false;
    current.setSelectedMedia(media);
    return true;
  };
}
