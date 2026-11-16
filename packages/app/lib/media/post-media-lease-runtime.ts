import { AppState } from 'react-native';
import { onPostMediaLeaseRetirement, retirePostMediaLeases } from './post-media-lease-events';
import { invokeEdge } from '@dvnt/app/lib/api/invoke-edge';
import { useAuthStore } from '@dvnt/app/lib/stores/auth-store';
import { useAppStore } from '@dvnt/app/lib/stores/app-store';
import { subscribeSessionLifecycle } from '@dvnt/app/lib/auth/session-lifecycle';
import { createPostMediaLeaseCache, type PostMediaLease } from './post-media-lease';

export const postMediaLeases = createPostMediaLeaseCache(async postId => {
  const state = useAuthStore.getState();
  const {data,error} = await invokeEdge<PostMediaLease>('post-media-lease',{postId},{requireAuth:!!state.isAuthenticated});
  if(error || !data) throw Error('Post media unavailable');
  return data;
});
useAuthStore.subscribe((next,old)=>{
  if(next.user?.id!==old.user?.id || next.user?.authId!==old.user?.authId || next.isAuthenticated!==old.isAuthenticated || next.authStatus!==old.authStatus)retirePostMediaLeases();
});
useAppStore.subscribe((next,old)=>{if(next.nsfwEnabled!==old.nsfwEnabled)retirePostMediaLeases();});
subscribeSessionLifecycle(()=>retirePostMediaLeases());

onPostMediaLeaseRetirement(()=>postMediaLeases.retire());

// One foreground listener per runtime, not one per tile (avoids renewal storms).
AppState.addEventListener('change',state=>{if(state==='active')postMediaLeases.resume();});
if(typeof window!=='undefined')window.addEventListener('focus',()=>postMediaLeases.resume());
if(typeof document!=='undefined')document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='visible')postMediaLeases.resume();
});
