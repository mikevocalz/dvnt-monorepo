import { useEffect, useMemo, useSyncExternalStore } from 'react';
import { protectedPostMediaEnabled } from './post-media-delivery';
import { postMediaLeases } from './post-media-lease-runtime';
import { EMPTY_POST_MEDIA, type LeasedPostMedium } from './post-media-lease';

/** Never consult fallback URLs when protected delivery is enabled. */
export function usePostMediaLease<T extends {url?: string}>(postId: string | number | undefined, fallback: T[]): T[] {
  const enabled=protectedPostMediaEnabled();
  const id=String(postId ?? '');
  const media=useSyncExternalStore(
    fn=>postMediaLeases.subscribe(id,fn),
    ()=>postMediaLeases.snapshot(id),
    ()=>EMPTY_POST_MEDIA,
  );
  useEffect(()=>{
    if(!enabled || !id)return;
    return postMediaLeases.retain(id);
  },[enabled,id]);
  return enabled ? media as unknown as T[] : fallback;
}
export type { LeasedPostMedium };

/** Project a render snapshot, never mutate/persist signed URLs into the source post. */
export function useLeasedPost<T extends {id:string;media?:any[];thumbnail?:string}>(post:T|null|undefined):T|null|undefined {
  const media=usePostMediaLease(post?.id,post?.media??[]);
  const enabled=protectedPostMediaEnabled();
  return useMemo(()=> !post || !enabled ? post : {...post,media,thumbnail:media[0]?.thumbnail},[post,media,enabled]);
}
