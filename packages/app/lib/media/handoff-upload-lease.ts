import { isSignedMediaLeaseUrl } from "./signed-media-lease-url";
import { invokeEdge } from '../api/invoke-edge';
import { protectedPostMediaEnabled } from './post-media-delivery';
import { captureAuthContinuation } from '../auth/continuation-guard';
import type { MediaAsset } from '../hooks/use-media-picker';

export async function leaseHandoffUpload(asset: MediaAsset, isCurrent: () => boolean) {
  const receipt=asset.handoffUpload;
  const ids=[receipt?.photoId,receipt?.motionId];
  if (!receipt || new Set(ids).size !== 2 || ids.some(id=>!Number.isSafeInteger(id) || Number(id)<=0) || !isCurrent()) throw Error('Upload preview unavailable');
  const {data,error}=await invokeEdge<{expiresAt:number;uploads:Array<{mediaId:number;url:string;mimeType:string}>}>('post-media-lease',{uploadMediaIds:ids},{requireAuth:true});
  if(error || !data || !isCurrent() || !Number.isSafeInteger(data.expiresAt) || data.expiresAt*1000<=Date.now()+1000 || data.expiresAt*1000>Date.now()+120000) throw Error('Upload preview unavailable');
  if(!Array.isArray(data.uploads) || data.uploads.length!==2 || new Set(data.uploads.map(item=>item.mediaId)).size!==2 ||
    data.uploads.some(item=>!ids.includes(item.mediaId) || !isSignedMediaLeaseUrl(item.url,data.expiresAt)))throw Error('Upload preview unavailable');
  const urls=ids.map(id=>data.uploads.find(item=>item.mediaId===id)!.url);
  return {expiresAt:data.expiresAt,media:{...asset,uri:urls[0]!,originalUri:urls[0]!,pairedVideoUri:urls[1]!}};
}

/** Scanner accepts only local bytes. Fetch only fresh, server-issued owner leases,
 * never raw draft URLs. Token/blob references never enter the persisted draft. */
export async function withLeasedHandoffScan<T>(media: MediaAsset[], signal: AbortSignal, scan:(media:MediaAsset[])=>Promise<T>):Promise<T> {
  if(!protectedPostMediaEnabled() || !media.some(item=>item.handoffUpload))return scan(media);
  const owner=captureAuthContinuation();const blobs:string[]=[];let earliestExpiry=Infinity;
  const current=()=>!signal.aborted&&owner.isCurrent();
  try {
    const prepared:MediaAsset[]=[];
    for(const item of media) {
      if(!item.handoffUpload){prepared.push(item);continue;}
      const lease=await leaseHandoffUpload(item,current);
      earliestExpiry=Math.min(earliestExpiry,lease.expiresAt*1000);
      const urls=[];
      for(const url of [lease.media.uri,lease.media.pairedVideoUri!]) {
        if(!current() || lease.expiresAt*1000<=Date.now())throw Error('Upload preview expired');
        const response=await fetch(url,{signal,cache:'no-store',redirect:'error'});
        if(!response.ok || !current())throw Error('Upload preview unavailable');
        const blob=await response.blob();if(!current() || earliestExpiry<=Date.now())throw Error('Upload preview unavailable');
        const local=URL.createObjectURL(blob);blobs.push(local);urls.push(local);
      }
      prepared.push({...item,uri:urls[0],originalUri:urls[0],pairedVideoUri:urls[1]});
    }
    if(!current() || earliestExpiry<=Date.now())throw Error('Upload preview unavailable');
    return await scan(prepared);
  } finally {owner.release();blobs.forEach(url=>URL.revokeObjectURL(url));}
}
