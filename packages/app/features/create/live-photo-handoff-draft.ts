import type { MediaAsset } from '../../lib/hooks/use-media-picker';
import type { HandoffAsset, LivePhotoHandoff } from '../../lib/api/live-photo-handoff';

export type HandoffDraft = {
  selectedMedia: MediaAsset[];
  caption: string;
  textSlides: unknown[];
  activeTextSlideIndex: number;
  location: string;
  locationData: unknown;
  taggedPeople: string[];
  tags: string[];
  placedTags: unknown[];
  isNSFW: boolean;
  postKind: string;
  textTheme: string;
  step: string;
};
export type SavedHandoff = {
  ownerId: string;
  draftId: string;
  requestId: string;
  savedAt: number;
  draft: HandoffDraft;
  blobs: Record<string, Blob>;
  handoff?: LivePhotoHandoff;
  applied?: boolean;
};
export function snapshotHandoffDraft(draft: HandoffDraft): HandoffDraft {
  // Explicit allowlist: never persist store methods, auth or transient locks.
  return {
    selectedMedia: draft.selectedMedia.map(media => ({ ...media })), caption: draft.caption,
    textSlides: structuredClone(draft.textSlides), activeTextSlideIndex: draft.activeTextSlideIndex,
    location: draft.location, locationData: structuredClone(draft.locationData),
    taggedPeople: [...draft.taggedPeople], tags: [...draft.tags], placedTags: structuredClone(draft.placedTags),
    isNSFW: draft.isNSFW, postKind: draft.postKind, textTheme: draft.textTheme, step: draft.step,
  };
}
export function draftFingerprint(draft: HandoffDraft): string {
  return JSON.stringify(snapshotHandoffDraft(draft));
}
const URI_FIELDS = ['uri', 'originalUri', 'editedUri', 'pairedVideoUri'] as const;
/** A failed/quota-limited save must prevent opening the app. Blob URLs alone cannot survive reload. */
export async function captureHandoffDraft(
  ownerId: string, draft: HandoffDraft,
  readBlob: (uri: string) => Promise<Blob> = async uri => {
    const response = await fetch(uri);
    if (!response.ok) throw new Error('Could not save selected media. Keep this browser tab open and retry.');
    return response.blob();
  },
): Promise<SavedHandoff> {
  const snapshot = snapshotHandoffDraft(draft);
  const blobs: Record<string, Blob> = {};
  for (const media of snapshot.selectedMedia) {
    for (const field of URI_FIELDS) {
      const uri = media[field];
      if (uri?.startsWith('blob:') && !blobs[uri]) blobs[uri] = await readBlob(uri);
    }
  }
  return { ownerId, draftId: crypto.randomUUID(), requestId: crypto.randomUUID(), savedAt: Date.now(), draft: snapshot, blobs };
}
export function restoreHandoffDraft(saved: SavedHandoff, ownerId: string, createUrl = (blob: Blob) => URL.createObjectURL(blob)): HandoffDraft {
  if (saved.ownerId !== ownerId) throw new Error('Sign in to the account that started this draft.');
  const urls = new Map<string, string>();
  const draft = snapshotHandoffDraft(saved.draft);
  for (const media of draft.selectedMedia) {
    for (const field of URI_FIELDS) {
      const uri = media[field];
      if (!uri?.startsWith('blob:')) continue;
      const blob = saved.blobs[uri];
      if (!blob) throw new Error('Saved media is unavailable. Your current draft has not been changed.');
      if (!urls.has(uri)) urls.set(uri, createUrl(blob));
      media[field] = urls.get(uri)!;
    }
  }
  return draft;
}
export function addHandoffAssets(draft: HandoffDraft, assets: HandoffAsset[], ownerId: string, handoffId: string): HandoffDraft {
  if (!assets.length || assets.length > 10) throw new Error('No complete Live Photos were received.');
  const additions: MediaAsset[] = assets.map((asset, index) => {
    if (!asset.url.startsWith('https://') || !asset.livePhotoVideoUrl.startsWith('https://')) throw new Error('Incomplete Live Photo received.');
    return {
      id: `handoff-${handoffId}-${index}`, uri: asset.url, originalUri: asset.url,
      pairedVideoUri: asset.livePhotoVideoUrl, type: 'image', kind: 'livePhoto',
      mimeType: asset.mimeType, width: asset.width ?? undefined, height: asset.height ?? undefined,
      handoffUpload: { ownerId, type: 'image', url: asset.url, livePhotoVideoUrl: asset.livePhotoVideoUrl, mimeType: asset.mimeType },
    };
  });
  const ids = new Set(draft.selectedMedia.map(media => media.id));
  const selectedMedia = [...draft.selectedMedia, ...additions.filter(media => !ids.has(media.id))];
  if (selectedMedia.length > 10) throw new Error('This draft can contain at most 10 photos or videos.');
  return { ...draft, selectedMedia };
}
