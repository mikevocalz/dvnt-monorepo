#!/usr/bin/env node
// Real React form + actual File/Blob URLs. Media readiness events are mocked;
// browser decoding is exercised by the real-browser regression companion.
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
  const revoked = new Set();
  const realRevoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = url => { revoked.add(url); realRevoke(url); };
  const videos = [];
  const realCreate = document.createElement.bind(document);
  document.createElement = (name, ...args) => {
    const el = realCreate(name, ...args);
    if (name === 'video') videos.push(el);
    return el;
  };
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'browser-live-photo-import-'));
  try {
    await build({ stdin: { contents: `
      import React, { act } from 'react'; import { createRoot } from 'react-dom/client';
      import { LivePhotoPairPicker } from './packages/app/features/create/live-photo-pair-picker.web';
      import { captureBrowserMediaCommit, readPlayableLivePhotoDuration, releaseBrowserMediaAsset } from './packages/app/features/create/browser-live-photo-import';
      export { act, readPlayableLivePhotoDuration, releaseBrowserMediaAsset };
      export function mount(node) {
        const root = createRoot(node);
        let state = { selectedMedia: [], textSlides: [{}], postKind: 'media', setSelectedMedia: media => { state = { ...state, selectedMedia: media }; render(); } };
        const render = () => root.render(<React.StrictMode><LivePhotoPairPicker disabled={state.selectedMedia.length >= 10} selectionIdentity={state.selectedMedia} draftIdentity={state.textSlides} beginAdd={() => captureBrowserMediaCommit(() => state)} /></React.StrictMode>);
        render();
        return { get: () => state, change: patch => { state = { ...state, ...patch }; render(); }, unmount: () => root.unmount() };
      }
    `, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', outfile: path.join(dir, 'fixture.cjs'), nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean) });
    const { act, mount, readPlayableLivePhotoDuration, releaseBrowserMediaAsset } = require(path.join(dir, 'fixture.cjs'));
    const still = new File([new Uint8Array([255, 216, 255, 1])], 'IMG_0001.JPG', { type: 'image/jpeg' });
    const motion = new File([new Uint8Array([0, 1, 2, 3])], 'IMG_0001.MOV', { type: 'video/quicktime' });
    const replacement = new File([new Uint8Array([4, 5, 6, 7])], 'Other.MP4', { type: 'video/mp4' });
    const ready = video => {
      Object.defineProperties(video, { readyState: { configurable: true, value: 3 }, duration: { configurable: true, value: 3 } });
      video.dispatchEvent(new window.Event('loadeddata', { bubbles: true }));
    };
    // Metadata-only (including HEVC duration) is not proof of decode support.
    let settled = false;
    const read = readPlayableLivePhotoDuration(motion).then(value => { settled = true; return value; });
    const probe = videos.at(-1); Object.defineProperty(probe, 'duration', { configurable: true, value: 3 });
    probe.dispatchEvent(new window.Event('loadedmetadata'));
    await Promise.resolve(); assert.equal(settled, false);
    ready(probe); assert.equal(await read, 3); assert.ok(!probe.getAttribute('src'));
    const unsupported = readPlayableLivePhotoDuration(motion);
    videos.at(-1).dispatchEvent(new window.Event('error')); assert.equal(await unsupported, null);

    const node = document.createElement('div'); document.body.append(node);
    let app; await act(async () => { app = mount(node); });
    const button = text => [...node.querySelectorAll('button')].find(el => el.textContent === text);
    const open = async () => act(async () => button('Add Live Photo').click());
    const choose = async (index, file) => act(async () => {
      const input = node.querySelectorAll('input')[index];
      Object.defineProperty(input, 'files', { configurable: true, value: file ? [file] : [] });
      input.dispatchEvent(new window.Event('change', { bubbles: true }));
    });
    const selectPair = async () => { await open(); await choose(0, still); await choose(1, motion); };
    const makePreviewReady = async () => act(async () => ready(node.querySelector('video')));
    const startAdd = async () => act(async () => button('Add pair to post').click());
    const finishProbe = async () => act(async () => ready(videos.at(-1)));

    await selectPair();
    assert.equal(node.querySelectorAll('input').length, 2);
    assert.ok([...node.querySelectorAll('input')].every(el => !el.multiple));
    assert.equal(button('Add pair to post').disabled, true, 'must decode motion before Add');
    const previewURLs = [node.querySelector('video').getAttribute('src'), node.querySelector('video').getAttribute('poster')];
    await makePreviewReady(); assert.equal(button('Add pair to post').disabled, false);
    await choose(1, null); assert.ok(node.textContent.includes(motion.name), 'cancel OS picker retains selected half');
    await startAdd(); assert.equal(button('Checking pair…').disabled, true);
    await finishProbe();
    assert.equal(app.get().selectedMedia.length, 1); assert.equal(app.get().selectedMedia[0].kind, 'livePhoto');
    const first = app.get().selectedMedia[0];
    assert.ok(previewURLs.every(url => revoked.has(url)), 'only preview URLs released after Add');
    assert.equal(revoked.has(first.uri), false); assert.equal(revoked.has(first.pairedVideoUri), false);
    assert.deepEqual(await (await fetch(first.pairedVideoUri)).arrayBuffer(), await motion.arrayBuffer());
    assert.equal(node.querySelector('input'), null, 'panel resets for next explicit pair');

    await selectPair(); await makePreviewReady(); await startAdd(); await finishProbe();
    assert.equal(app.get().selectedMedia.length, 2); assert.notEqual(first.id, app.get().selectedMedia[1].id);
    assert.equal(app.get().selectedMedia[0].pairedVideoUri, first.pairedVideoUri, 'adding another pair preserves first association');

    await selectPair();
    await act(async () => node.querySelector('video').dispatchEvent(new window.Event('error')));
    assert.equal(button('Add pair to post').disabled, true); assert.match(node.textContent, /could not play/);
    await act(async () => button('Retry motion preview').click()); await makePreviewReady();
    await startAdd();
    const cancelledProbe = videos.at(-1);
    await act(async () => button('Cancel').click());
    await act(async () => ready(cancelledProbe));
    assert.equal(app.get().selectedMedia.length, 2, 'cancelled late validation must not append');

    await selectPair(); await makePreviewReady(); await startAdd();
    const oldProbe = videos.at(-1);
    await choose(1, replacement);
    await act(async () => ready(oldProbe));
    assert.equal(app.get().selectedMedia.length, 2, 'replaced pending motion must not append the old pair');
    assert.ok(node.textContent.includes(replacement.name));
    await makePreviewReady(); await startAdd(); await finishProbe();
    assert.equal(app.get().selectedMedia.length, 3);
    assert.deepEqual(await (await fetch(app.get().selectedMedia[2].pairedVideoUri)).arrayBuffer(), await replacement.arrayBuffer());

    await selectPair(); await makePreviewReady(); await startAdd();
    const reorderedProbe = videos.at(-1);
    await act(async () => app.change({ selectedMedia: [...app.get().selectedMedia].reverse() }));
    await act(async () => ready(reorderedProbe));
    assert.equal(app.get().selectedMedia.length, 3, 'selection reorder invalidates in-flight import');
    assert.equal(app.get().selectedMedia[2].id, first.id);

    const committed = [...app.get().selectedMedia];
    await selectPair(); await makePreviewReady(); await startAdd();
    const resetProbe = videos.at(-1);
    await act(async () => app.change({ selectedMedia: [], textSlides: [{}] }));
    await act(async () => ready(resetProbe));
    assert.equal(app.get().selectedMedia.length, 0, 'reset draft cannot receive stale pair');
    await act(async () => app.change({ selectedMedia: Array.from({ length: 10 }, () => first) }));
    assert.equal(button('Add Live Photo').disabled, true);
    await act(async () => app.change({ selectedMedia: [] }));
    await selectPair(); await makePreviewReady(); await startAdd();
    const unmountProbe = videos.at(-1);
    await act(async () => app.unmount()); await act(async () => ready(unmountProbe));
    assert.equal(app.get().selectedMedia.length, 0, 'unmount cancels pending import');
    for (const asset of committed) {
      assert.equal(revoked.has(asset.uri), false, 'committed assets survive importer cleanup for publish/retry');
      releaseBrowserMediaAsset(asset);
    }
    console.log('PASS browser Live Photo import DOM: explicit files, decode gate, byte preservation, repeat pairs, cancel/retry/replace, reorder/reset/unmount guards, cap and URL ownership.');
  } finally { URL.revokeObjectURL = realRevoke; window.happyDOM.abort(); fs.rmSync(dir, { recursive: true, force: true }); }
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
