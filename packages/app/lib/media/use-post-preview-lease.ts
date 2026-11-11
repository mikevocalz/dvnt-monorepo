import { usePostMediaLease } from './use-post-media-lease';
import { protectedPostMediaEnabled } from './post-media-delivery';

/** Post previews must never fall back to persisted thumbnails after rollout. */
export function usePostPreviewLease(postId: string | number | undefined, fallback?: string): string | undefined {
  const media = usePostMediaLease(postId, [] as Array<{url?: string; thumbnail?: string; type?: string}>);
  if (!protectedPostMediaEnabled()) return fallback;
  const first = media[0];
  return first?.thumbnail || (first?.type === 'video' || first?.type === 'animated_video' ? undefined : first?.url);
}

/** Preserve layout/type metadata, replace every fetchable grid media field. */
export function usePostGridLease<T extends {id:string;kind:string;coverUrl:string|null;videoUrl:string|null;livePhotoVideoUrl?:string|null}>(tile:T):T {
  const media = usePostMediaLease(tile.id, [] as Array<{url?:string;thumbnail?:string;livePhotoVideoUrl?:string;type?:string}>);
  if (!protectedPostMediaEnabled()) return tile;
  const first=media[0];
  const video=first?.type === 'video' || first?.type === 'animated_video';
  return {...tile,coverUrl:first?.thumbnail || (!video ? first?.url : null) || null,
    videoUrl:video ? first?.url || null : null,livePhotoVideoUrl:first?.livePhotoVideoUrl || null};
}
