import { createBrowserLivePhotoAsset } from '../../../packages/app/features/create/browser-live-photo-import';
import { uploadLivePhotoPair } from '../../../packages/app/lib/media/live-photo-upload';
import { uploadToServer } from '../../../packages/app/lib/server-upload';
import { createPublishTask } from '../../../packages/app/lib/posts/publish-task';
import { postsApi } from '../../../packages/app/lib/api/posts';
import { resolveWebPostMedia } from '../../../packages/app/components/feed/web-post-media';
import type { PublishDescriptor, PublishMediaFile } from '../../../packages/app/lib/posts/publish-descriptor';

export { createBrowserLivePhotoAsset, resolveWebPostMedia };
export const state: { descriptor?: PublishDescriptor; created?: Awaited<ReturnType<typeof postsApi.createPost>> } = {};
export function prepare(files: PublishMediaFile[], operationId: string) {
  state.created = undefined;
  state.descriptor = {
    operationId, postKind: 'media', content: 'Synthetic Live Photo roundtrip',
    slides: [], textTheme: 'graphite', location: '', isNSFW: false,
    files, placedTags: [], uploaded: files.map(() => null),
  };
}
export async function publish() {
  if (!state.descriptor) throw new Error('No fixture draft');
  await createPublishTask(state.descriptor, 'fixture-owner', {
    currentOwnerId: () => 'fixture-owner', persistMedia: async file => file,
    uploadMedia: async files => Promise.all(files.map(async file => {
      const result = await uploadLivePhotoPair(file, uri => uploadToServer(uri, 'posts'));
      if (!result.success) return { error: result.error };
      return { type: result.type, url: result.url, mimeType: result.mimeType, livePhotoVideoUrl: result.livePhotoVideoUrl };
    })),
    createPost: async input => { state.created = await postsApi.createPost(input); return state.created; },
    addPlacedTags: () => { throw new Error('No tags expected'); },
  })(() => {}, descriptor => { state.descriptor = descriptor; });
  return state.created;
}
export const read = (id: string) => postsApi.getPostById(id);
