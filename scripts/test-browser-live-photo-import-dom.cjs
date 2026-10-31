#!/usr/bin/env node
// Actual production CreatePostScreen + unified picker under React StrictMode.
// Auth/publication are isolated stubs; Files/Blob URLs and UI events are real.
// Video decode events are controlled here; the browser roundtrip uses ffmpeg.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');

(async () => {
  const { Window } = await import(require.resolve('happy-dom'));
  const window = new Window();
  Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  window.HTMLMediaElement.prototype.load = function () {};
  const revoked = new Set(); const realRevoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = url => { revoked.add(url); realRevoke(url); };
  const videos = []; const create = document.createElement.bind(document);
  document.createElement = (name, ...args) => { const node = create(name, ...args); if (name === 'video') videos.push(node); return node; };
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unified-media-composer-'));
  const mockState = `
    import { create } from 'zustand';
    const initial = () => ({ selectedMedia: [], caption: '', textSlides: [{ id: 'slide', content: '', order: 0 }], activeTextSlideIndex: 0, isNSFW: false, tags: [], postKind: 'media', textTheme: 'graphite' });
    export const fixture = { published: [], toasts: [], routes: [], deferGate: false, gate: null, progress: [], failPublish: false, deferPublish: false, finishPublish: null };
    export const store = create((set) => ({ ...initial(), setSelectedMedia: selectedMedia => set({selectedMedia}), setCaption: caption => set({caption}), setPostKind: postKind => set({postKind}), setIsNSFW: isNSFW => set({isNSFW}), reset: () => set(initial()), setTextTheme: textTheme => set({textTheme}), setActiveTextSlideIndex: () => {}, updateTextSlide: () => {}, addTextSlide: () => {}, removeTextSlide: () => {}, addTag: () => {}, removeTag: () => {} }));
    export const ui = create(set => ({ isSubmitLocked: false, tagInput: '', setTagInput: tagInput => set({tagInput}), setIsSubmitLocked: isSubmitLocked => set({isSubmitLocked}) }));
    export const camera = create(() => ({ result: null, clear: () => {} }));
  `;
  const mocks = {
    './native-live-photo-handoff.web': `export const NativeLivePhotoHandoff = () => null;`,
    'next/dynamic': `export default () => () => null;`,
    'solito/navigation': `import {fixture} from 'composer-fixture'; export const useRouter = () => ({ back: () => fixture.routes.push('back'), push: route => fixture.routes.push(route), replace: route => fixture.routes.push(route) });`,
    '@dvnt/app/lib/stores/create-post-store': `export {store as useCreatePostStore} from 'composer-fixture';`,
    '@dvnt/app/lib/hooks/use-verified-gate': `import {fixture} from 'composer-fixture'; export const useVerifiedGate = () => (_action, callback) => { if(fixture.deferGate) fixture.gate = callback; else callback(); };`,
    '@dvnt/app/lib/hooks/use-publish-post': `import {fixture} from 'composer-fixture'; export const usePublishPost = () => draft => { fixture.published.push(draft.selectedMedia.map(item => ({...item}))); return 'fixture'; };`,
    '@dvnt/app/lib/posts/publish-queue': `import {fixture} from 'composer-fixture'; export const postPublishQueue = { whenFinished: async () => { if(fixture.failPublish) throw Error('fixture publication failed'); if(fixture.deferPublish) await new Promise(resolve=>{fixture.finishPublish=resolve}); } };`,
    '@dvnt/app/lib/profile/new-member-progress': `import {fixture} from 'composer-fixture'; export const fetchNewMemberProgress = async () => fixture.progress.shift() || ({step:'complete',hasPost:true});`,
    '@dvnt/app/lib/posts/first-post-event': `export const assertFirstPostPublishable = async () => {};`,
    '@dvnt/app/lib/stores/auth-store': `export const useAuthStore={getState:()=>({user:{id:'fixture-member'}})};`,
    '@dvnt/app/lib/stores/first-post-offer-store': `export const useFirstPostOfferStore = {getState:()=>({clearPending:()=>{}})};`,
    '@dvnt/app/lib/stores/ui-store': `import {fixture} from 'composer-fixture'; export const useUIStore = selector => selector({showToast:(...args)=>fixture.toasts.push(args)});`,
    '@dvnt/app/lib/stores/camera-result-store': `export {camera as useCameraResultStore} from 'composer-fixture';`,
    '@dvnt/app/lib/hooks/use-responsive-grid': `export const useResponsiveGrid = () => ({columns:2});`,
    './create-post-location.web': `export const CreatePostLocation = () => null;`,
    './create-post-ui-store': `export {ui as useCreatePostUIStore} from 'composer-fixture';`,
  };
  try {
    await build({ stdin: { contents: `
      import React, { act } from 'react'; import { createRoot } from 'react-dom/client';
      import { CreatePostScreen } from './packages/app/features/create/create-post.web';
      export { fixture, store } from 'composer-fixture'; export { act };
      export function mount(node) { const root = createRoot(node); root.render(<React.StrictMode><CreatePostScreen/></React.StrictMode>); return () => root.unmount(); }
    `, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', outfile: path.join(dir, 'fixture.cjs'), alias: { '@dvnt/app': path.join(root, 'packages/app') }, plugins: [{ name: 'isolated-composer', setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (args.path === 'composer-fixture') return { path: args.path, namespace: 'fixture' };
        const key = mocks[args.path] ? args.path : Object.keys(mocks).find(key => key.startsWith('@dvnt/app/') && args.path === path.join(root, 'packages/app', key.slice('@dvnt/app/'.length)));
        if (key) return { path: key, namespace: 'mock' };
      });
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: mockState, loader: 'js', resolveDir: root }));
      build.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js', resolveDir: root }));
    } }], nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean) });
    const { act, mount, fixture, store } = require(path.join(dir, 'fixture.cjs'));
    const image = (name = 'Photo.jpg') => new File([new Uint8Array([255, 216, 1])], name, { type: 'image/jpeg' });
    const movie = (name = 'Photo.mov') => new File([new Uint8Array([0, 1, 2, 3])], name, { type: 'video/quicktime' });
    const node = document.createElement('div'); document.body.append(node); let unmount;
    await act(async () => { unmount = mount(node); });
    const button = text => [...node.querySelectorAll('button')].find(el => el.textContent.trim() === text);
    const share = () => button('Share');
    const assets = () => store.getState().selectedMedia;
    const cards = () => [...node.querySelectorAll('[data-browser-media-id]')];
    const card = id => cards().find(el => el.getAttribute('data-browser-media-id') === id);
    const pick = async files => act(async () => {
      const input = node.querySelector('input[type=file]'); Object.defineProperty(input, 'files', { configurable: true, value: files });
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    const probes = () => videos.filter(video => !video.isConnected && video.onloadeddata && video.getAttribute('src'));
    const ready = video => { Object.defineProperties(video, { duration: { configurable: true, value: 3 }, readyState: { configurable: true, value: 3 } }); video.dispatchEvent(new window.Event('loadeddata')); };
    const finish = async () => act(async () => { const active = probes(); assert.equal(active.length, 1); ready(active[0]); });
    const finishBatch = async () => { for (let i = 0; probes().length && i < 30; i++) await finish(); assert.equal(probes().length, 0); };
    const chooseMotion = async (imageId, motionId) => act(async () => {
      const select = card(imageId).querySelector('select'); select.value = motionId; select.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    const cancel = async () => act(async () => button('Cancel checking').click());

    assert.equal(node.querySelectorAll('input[type=file]').length, 1, 'exactly one unified file entry');
    assert.equal(node.querySelector('input[type=file]').multiple, true);
    assert.equal(button('Add Live Photo'), undefined);
    await pick([image('ordinary.jpg')]); assert.equal(assets().length, 1); assert.equal(share().disabled, false);
    const original = assets()[0];
    await pick([movie('cancel.mov')]); assert.equal(share().disabled, true); const canceled = probes()[0];
    await cancel(); assert.equal(share().disabled, false);
    await act(async () => ready(canceled)); assert.equal(assets().length, 1, 'cancelled intake cannot append late');

    await pick([image('never-half.jpg'), new File([1], 'unsupported.webm', { type: 'video/webm' })]);
    assert.equal(assets().length, 1, 'invalid motion rejects entire new batch, not only the motion');
    assert.equal(assets()[0].id, original.id); assert.match(node.textContent, /files were not added/);
    await pick([image('never-corrupt-half.jpg'), movie('broken.mov')]);
    await act(async () => probes()[0].dispatchEvent(new window.Event('error')));
    assert.equal(assets().length, 1, 'undecodable motion also rejects complete batch');
    assert.equal(share().disabled, false);

    await pick([image('duplicate.jpg'), movie('duplicate.mov'), image('duplicate.jpg')]); await finishBatch();
    assert.equal(assets().length, 4); assert.ok(assets().every(item => item.kind !== 'livePhoto'), 'filenames never imply pairing');
    const photo = assets()[1]; const clip = assets()[2]; const other = assets()[3];
    await chooseMotion(photo.id, clip.id); assert.equal(share().disabled, true);
    await act(async () => probes()[0].dispatchEvent(new window.Event('error')));
    assert.equal(assets().length, 4); assert.equal(share().disabled, false); assert.match(node.textContent, /files remain separate/);
    await chooseMotion(photo.id, clip.id); await finish();
    assert.equal(assets().length, 3); assert.equal(assets()[1].kind, 'livePhoto'); assert.equal(share().disabled, false);
    assert.equal(assets()[1].pairedVideoUri, clip.uri); assert.equal(revoked.has(clip.uri), false);
    await chooseMotion(photo.id, ''); assert.equal(assets().length, 4); assert.equal(revoked.has(clip.uri), false);
    assert.equal((await fetch(clip.uri)).ok, true, 'separating does not revoke the restored clip');

    await chooseMotion(photo.id, clip.id); const reordered = probes()[0];
    await act(async () => card(photo.id).querySelector('[aria-label="Move duplicate.jpg up"]').click());
    await act(async () => ready(reordered)); assert.equal(assets().length, 4); assert.ok(assets().every(item => item.kind !== 'livePhoto'));
    await chooseMotion(photo.id, clip.id); const removed = probes()[0];
    await act(async () => card(other.id).querySelector('[aria-label="Remove duplicate.jpg"]').click());
    await act(async () => ready(removed)); assert.equal(assets().length, 3); assert.ok(assets().every(item => item.kind !== 'livePhoto'));

    // Verification can return after a new import begins. Production submit's
    // synchronous ref must still refuse to publish, even beyond disabled UI.
    fixture.deferGate = true;
    await act(async () => share().click()); assert.equal(typeof fixture.gate, 'function');
    await pick([movie('late.mov')]); assert.equal(share().disabled, true);
    await act(async () => fixture.gate()); assert.equal(fixture.published.length, 0);
    assert.match(fixture.toasts.at(-1)[1], /still being checked/);
    const late = probes()[0]; await cancel(); await act(async () => ready(late));
    fixture.deferGate = false;
    window.sessionStorage.setItem('dvnt:review-return', JSON.stringify({userId:'fixture-member',target:'/feed/events/42/reviews',savedAt:Date.now()}));
    fixture.progress = [{step:'first_post',hasPost:false}]; fixture.failPublish = true;
    await act(async () => share().click());
    assert.equal(fixture.routes.length, 0, 'failed first post must not redirect or consume review intent');
    assert.ok(window.sessionStorage.getItem('dvnt:review-return'));
    fixture.failPublish = false; fixture.published.length = 0;
    fixture.progress = [{step:'first_post',hasPost:false}, {step:'complete',hasPost:true}];
    await act(async () => share().click()); assert.equal(fixture.published.length, 1);
    assert.equal(fixture.routes.at(-1), '/feed/events/42/reviews', 'only confirmed first-post completion resumes review');
    assert.equal(window.sessionStorage.getItem('dvnt:review-return'), null);
    assert.equal(fixture.published[0].length, 3); assert.equal(assets().length, 0);

    await pick([image('cancel-first-post.jpg')]);
    fixture.progress = [{step:'first_post',hasPost:false}, {step:'complete',hasPost:true}]; fixture.deferPublish = true;
    window.sessionStorage.setItem('dvnt:review-return', JSON.stringify({userId:'fixture-member',target:'/feed/events/42/reviews',savedAt:Date.now()}));
    await act(async () => share().click());
    assert.equal(typeof fixture.finishPublish, 'function');
    const routesBeforeClose = fixture.routes.length;
    await act(async () => node.querySelector('[aria-label="Close"]').click());
    await act(async () => fixture.finishPublish());
    assert.equal(fixture.routes.length, routesBeforeClose + 1, 'Close is not followed by late publish navigation');
    assert.equal(fixture.routes.at(-1), 'back');
    assert.equal(assets().length, 1, 'late completion cannot reset a newer draft');
    assert.equal(window.sessionStorage.getItem('dvnt:review-return'), null);
    fixture.deferPublish = false; fixture.progress = [];
    await act(async () => store.getState().reset());

    const allFiles = Array.from({ length: 10 }, (_, i) => [image(`still-${i}.jpg`), movie(`clip-${i}.mov`)]).flat();
    await pick(allFiles); await finishBatch(); assert.equal(assets().length, 20); assert.equal(share().disabled, true);
    const raw = [...assets()];
    for (let i = 0; i < 10; i++) { await chooseMotion(raw[2*i].id, raw[2*i+1].id); await finish(); }
    assert.equal(assets().length, 10); assert.ok(assets().every(item => item.kind === 'livePhoto')); assert.equal(share().disabled, false);
    await chooseMotion(assets()[0].id, ''); assert.equal(assets().length, 10); assert.match(node.textContent, /Remove another item/);
    const discarded = assets()[0];
    await act(async () => card(discarded.id).querySelector('button[aria-label^="Remove"]').click());
    assert.equal(revoked.has(discarded.uri), true); assert.equal(revoked.has(discarded.pairedVideoUri), true);
    const preserved = assets()[0]; await chooseMotion(preserved.id, '');
    assert.equal(assets().length, 10); assert.equal(revoked.has(preserved.pairedVideoUri), false);

    // Source URLs already committed to the draft/queue survive component exit.
    const survivors = [...assets()];
    await pick([movie('unmount.mov')]); const detached = probes()[0];
    await act(async () => unmount()); await act(async () => ready(detached));
    assert.equal(assets().length, 10);
    for (const item of survivors) { assert.equal(revoked.has(item.uri), false); if (item.pairedVideoUri) assert.equal(revoked.has(item.pairedVideoUri), false); }
    console.log('PASS actual unified composer: one input, ordinary uploads, explicit reversible pairs, atomic batch errors, pending Share + delayed gate guard, cancel/retry/reorder/remove/unmount, original URL ownership,20raw→10pairs and split cap.');
  } finally { URL.revokeObjectURL = realRevoke; window.happyDOM.abort(); fs.rmSync(dir, { recursive: true, force: true }); }
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
