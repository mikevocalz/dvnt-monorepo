import React from 'react';
import { createRoot } from 'react-dom/client';
import { LivePhotoPairPicker } from '../../../packages/app/features/create/live-photo-pair-picker.web';
import { captureBrowserMediaCommit } from '../../../packages/app/features/create/browser-live-photo-import';
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
let selection = {
  selectedMedia: [], textSlides: [{}], postKind: 'media',
  setSelectedMedia: (media: any[]) => { selection = { ...selection, selectedMedia: media }; render(); },
};
async function showPost(id: string) {
  post = await client.read(id);
  if (!post) throw new Error('Persisted post not found');
  status = 'Saved post loaded'; render();
}
async function publish() {
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
function render() {
  root.render(<>
    {!post ? <>
      <LivePhotoPairPicker disabled={inFlight} selectionIdentity={selection.selectedMedia} draftIdentity={selection.textSlides} beginAdd={() => captureBrowserMediaCommit(() => selection)} />
      <output data-selected>{selection.selectedMedia.length}</output>
      <button type="button" data-publish disabled={inFlight || !selection.selectedMedia.length} onClick={() => void publish()}>Publish selected pairs</button>
    </> : <PostMediaCarousel key={post.id} media={post.media} caption={post.caption} />}
    <output data-status>{status}</output><Lightbox />
  </>);
}
Object.assign(window, { fixture: { client, getSelection: () => selection, getPost: () => post, closeLightbox: () => useLightboxStore.getState().close() } });
render();
const id = new URLSearchParams(location.hash.slice(1)).get('post');
if (id) void showPost(id).catch(error => { status = String(error); render(); });
