import React from 'react';
import { useMediaUpload } from '../../../packages/app/lib/hooks/use-media-upload';
import { createRoot } from 'react-dom/client';
import { BrowserMediaPicker } from '../../../packages/app/features/create/browser-media-picker.web';
import { captureBrowserMediaReplacement } from '../../../packages/app/features/create/browser-media-intake';
import { MAX_BROWSER_POST_MEDIA, releaseBrowserMediaAsset, type BrowserMediaSelection } from '../../../packages/app/features/create/browser-live-photo-import';
import { PostMediaCarousel } from '../../../packages/app/components/feed/post-media-carousel.web';
import { Lightbox } from '../../../packages/app/components/lightbox.web';
import { useLightboxStore } from '../../../packages/app/lib/stores/lightbox-store';
import * as client from './client';

// The composer shell is intentionally tiny; the selector, pair validation,
// uploader, post API, read mapper and renderer are the production components.
const root = createRoot(document.getElementById('root')!);
let post: Awaited<ReturnType<typeof client.read>>;
let status = 'Select original Live Photo files';
let inFlight = false;
let pending = false;
let selection: BrowserMediaSelection = {
  selectedMedia: [], textSlides: [{}], postKind: 'media',
  setSelectedMedia: (media: any[]) => { selection = { ...selection, selectedMedia: media }; render(); },
};
const updatePending = (value: boolean) => {
  if (pending === value) return;
  pending = value;
  render();
};
async function showPost(id: string) {
  post = await client.read(id);
  if (!post) throw new Error('Persisted post not found');
  status = 'Saved post loaded'; render();
}
async function publish() {
  if (inFlight || pending || selection.selectedMedia.length > MAX_BROWSER_POST_MEDIA) return;
  inFlight = true; status = 'Publishing'; render();
  try {
    if (!client.state.descriptor) client.prepare(selection.selectedMedia, 'browser-pair-roundtrip');
    const saved = await client.publish();
    if (!saved?.id) throw new Error('No saved post');
    location.hash = `post=${saved.id}`;
    await showPost(saved.id);
  } catch (error) {
    status = error instanceof Error ? error.message : String(error);
  } finally { inFlight = false; render(); }
}
// Only the fixture shell is synthetic: the video branch uses the production
// upload hook, web metadata validation, original pass-through and thumbnail.
function VideoUploadBoundary() {
  const upload = useMediaUpload({ folder: 'posts' });
  client.setVideoUploader(upload.uploadMultiple);
  return null;
}
function render() {
  root.render(<>
    <VideoUploadBoundary />
    {!post ? <>
      <BrowserMediaPicker selectedMedia={selection.selectedMedia} draftIdentity={selection.textSlides} disabled={inFlight}
        beginUpdate={() => captureBrowserMediaReplacement(() => selection, () => !inFlight)}
        onPendingChange={updatePending} />
      <output data-selected>{selection.selectedMedia.length}</output>
      <button type="button" data-publish disabled={inFlight || pending || !selection.selectedMedia.length || selection.selectedMedia.length > MAX_BROWSER_POST_MEDIA} onClick={() => void publish()}>Publish selected media</button>
    </> : <PostMediaCarousel key={post.id} media={post.media} caption={post.caption} />}
    <output data-status>{status}</output><Lightbox />
  </>);
}
function resetDraft() {
  if (inFlight || pending || post) throw new Error('Cannot reset an active or published fixture');
  selection.selectedMedia.forEach(releaseBrowserMediaAsset);
  selection = { ...selection, selectedMedia: [], textSlides: [{}] };
  client.state.descriptor = undefined;
  client.state.created = undefined;
  render();
}
Object.assign(window, { fixture: { client, getSelection: () => selection, getPost: () => post, resetDraft, isPending: () => pending, closeLightbox: () => useLightboxStore.getState().close() } });
render();
const id = new URLSearchParams(location.hash.slice(1)).get('post');
if (id) void showPost(id).catch(error => { status = String(error); render(); });
