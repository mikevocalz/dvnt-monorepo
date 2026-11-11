import { useEffect, useState } from 'react';
import { useAuthStore } from '../stores/auth-store';
import { subscribeSessionLifecycle } from '../auth/session-lifecycle';
import { captureAuthContinuation } from '../auth/continuation-guard';
import { onPostMediaLeaseRetirement } from './post-media-lease-events';
import { protectedPostMediaEnabled } from './post-media-delivery';
import { leaseHandoffUpload } from './handoff-upload-lease';
import type { MediaAsset } from '../hooks/use-media-picker';

export function useHandoffUploadLease(asset: MediaAsset):MediaAsset|undefined {
  const protectedUpload=protectedPostMediaEnabled()&&!!asset.handoffUpload;
  const key=JSON.stringify([asset.id,asset.handoffUpload?.photoId,asset.handoffUpload?.motionId]);
  const [lease,setLease]=useState<{key:string;expiresAt:number;media:MediaAsset;isCurrent:()=>boolean}>();
  const [generation,setGeneration]=useState(0);
  useEffect(()=>{
    if(!protectedUpload)return;
    const owner=captureAuthContinuation();let active=true,timer:ReturnType<typeof setTimeout>|undefined;
    const current=()=>active&&owner.isCurrent();
    const retire=()=>{setLease(undefined);setGeneration(value=>value+1);};
    const unsubscribe=onPostMediaLeaseRetirement(retire);
    const auth=useAuthStore.subscribe((next,previous)=>{if(next.user?.id!==previous.user?.id || next.user?.authId!==previous.user?.authId || next.isAuthenticated!==previous.isAuthenticated)retire();});
    const session=subscribeSessionLifecycle(retire);
    void leaseHandoffUpload(asset,current).then(value=>{
      if(!current())return;
      setLease({key,...value,isCurrent:current});
      timer=setTimeout(retire,Math.max(0,value.expiresAt*1000-Date.now()-1000));
    }).catch(()=>{if(active)setLease(undefined);});
    return()=>{active=false;clearTimeout(timer);unsubscribe();auth();session();owner.release();};
  },[key,protectedUpload,generation]);
  if(!protectedUpload)return asset;
  return lease?.key===key&&lease.isCurrent()&&lease.expiresAt*1000>Date.now()+1000?lease.media:undefined;
}
