import { invokeEdge } from './invoke-edge';

export interface HandoffAsset {
  photoId: number;
  motionId: number;
  url: string;
  livePhotoVideoUrl: string;
  mimeType: string;
  width?: number | null;
  height?: number | null;
}
export interface LivePhotoHandoff {
  id: string;
  draftId: string;
  state: 'pending' | 'ready' | 'consumed' | 'cancelled' | 'expired';
  expiresAt: string;
  maxCount: number;
  assets?: HandoffAsset[];
}
async function request(body: Record<string, unknown>): Promise<LivePhotoHandoff> {
  const { data, error } = await invokeEdge<{ ok: boolean; data: LivePhotoHandoff; error?: string }>('live-photo-handoff', body);
  if (error || !data?.ok || !data.data) throw new Error(error?.message || data?.error || 'Could not access the Live Photo handoff. Your draft is unchanged.');
  return data.data;
}
export const livePhotoHandoffApi = {
  create: (draftId: string, maxCount: number) => request({ action: 'create', draftId, maxCount }),
  status: (id: string, draftId: string) => request({ action: 'status', id, draftId }),
  complete: (id: string, draftId: string, pairs: { photoId: number; motionId: number }[]) => request({ action: 'complete', id, draftId, pairs }),
  consume: (id: string, draftId: string, requestId: string) => request({ action: 'consume', id, draftId, requestId }),
  cancel: (id: string, draftId: string) => request({ action: 'cancel', id, draftId }),
};
