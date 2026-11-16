import { isSignedMediaLeaseUrl } from './signed-media-lease-url';
/** Capability cache. Deliberately separate from persisted post/query snapshots. */
export interface LeasedPostMedium {
  order: number;
  type: string;
  url: string;
  mimeType?: string;
  thumbnail?: string;
  livePhotoVideoUrl?: string;
  postId?: string;
  expiresAt?: number;
}
export interface PostMediaLease {
  postId: number;
  expiresAt: number;
  media: LeasedPostMedium[];
}
export const EMPTY_POST_MEDIA: LeasedPostMedium[] = [];

export function createPostMediaLeaseCache(
  fetchLease: (postId: number) => Promise<PostMediaLease>,
  clock: { now: () => number; schedule: (fn: () => void, ms: number) => any; cancel: (id: any) => void } = {
    now: Date.now, schedule: (fn, ms) => globalThis.setTimeout(fn, ms),
    cancel: (id) => globalThis.clearTimeout(id),
  },
) {
  type Entry = { media: LeasedPostMedium[]; refs: number; listeners: Set<() => void>; generation: number; pending?: Promise<void>; refresh?: any; expiry?: any };
  const entries = new Map<string, Entry>();
  const entry = (id: string) => {
    let value = entries.get(id);
    if (!value) { value = {media: EMPTY_POST_MEDIA, refs: 0, listeners: new Set(), generation: 0}; entries.set(id, value); }
    return value;
  };
  const emit = (e: Entry) => { for (const fn of e.listeners) fn(); };
  const timers = (e: Entry) => { clock.cancel(e.refresh); clock.cancel(e.expiry); };
  const clear = (e: Entry) => { timers(e); e.generation++; e.pending = undefined; e.media = EMPTY_POST_MEDIA; emit(e); };
  const load = (id: string): Promise<void> => {
    const e = entry(id);
    if (e.pending) return e.pending;
    const generation = e.generation;
    const postId = Number(id);
    if (!Number.isSafeInteger(postId) || postId <= 0) return Promise.resolve();
    e.pending = Promise.resolve().then(() => fetchLease(postId)).then(lease => {
      if (generation !== e.generation || !e.refs) return;
      const ttl = lease.expiresAt * 1000 - clock.now();
      if (lease.postId !== postId || !Number.isFinite(ttl) || ttl <= 0 || ttl > 120000 || !Array.isArray(lease.media) || lease.media.length === 0 || lease.media.length > 20) throw Error('Invalid post media lease');
      const orders = new Set<number>();
      for (const m of lease.media) {
        if (!Number.isSafeInteger(m.order) || m.order < 0 || orders.has(m.order) || !isSignedMediaLeaseUrl(m.url,lease.expiresAt) ||
          (m.thumbnail !== undefined && !isSignedMediaLeaseUrl(m.thumbnail,lease.expiresAt)) ||
          (m.livePhotoVideoUrl !== undefined && !isSignedMediaLeaseUrl(m.livePhotoVideoUrl,lease.expiresAt))) throw Error('Invalid leased medium');
        orders.add(m.order);
      }
      timers(e);
      const thumbnail = lease.media.find(m => m.type === 'thumbnail')?.url;
      e.media = lease.media.filter(m => m.type !== 'thumbnail').map(m => ({...m,
        type: m.mimeType === 'video/mp4+animated' ? 'animated_video' :
          m.type === 'video' ? 'video' : m.livePhotoVideoUrl ? 'livePhoto' :
          m.mimeType === 'image/gif' ? 'gif' : m.mimeType?.startsWith('video/') ? 'video' : m.type,
        thumbnail: m.thumbnail ?? thumbnail,
        postId:id,expiresAt:lease.expiresAt})).sort((a,b)=>a.order-b.order);
      e.expiry = clock.schedule(() => { e.media = EMPTY_POST_MEDIA; emit(e); }, ttl);
      e.refresh = clock.schedule(() => { if (e.refs) void load(id); }, Math.max(1000,ttl-20000));
      emit(e);
    }).catch(() => { if (generation === e.generation) { timers(e); e.media = EMPTY_POST_MEDIA; emit(e); } }).finally(() => {
      if (generation === e.generation) e.pending = undefined;
    });
    return e.pending;
  };
  return {
    snapshot(id: string) { const media=entry(id).media; return media[0]?.expiresAt && media[0].expiresAt * 1000 <= clock.now() ? EMPTY_POST_MEDIA : media; },
    subscribe(id: string, fn: () => void) { const e=entry(id);e.listeners.add(fn);return()=>{e.listeners.delete(fn);}; },
    retain(id: string) { const e=entry(id);e.refs++;if(!e.media.length)void load(id);return()=>{e.refs--;if(!e.refs)clear(e);}; },
    refresh(id: string) { return load(id); },
    retire() { for(const [id,e] of entries){clear(e);if(e.refs)void load(id);} },
    /** Foreground means reauthorize, never trust a timer paused in the background. */
    resume() { for(const [id,e] of entries){clear(e);if(e.refs)void load(id);} },
  };
}
