#!/usr/bin/env node
// Production web carousel + lightbox under React. Media/viewport are mocked;
// real media decoding is covered separately by the browser companion test.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { build } = require('esbuild');

(async () => {
  const { Window } = await import(require.resolve('happy-dom'));
  const window = new Window();
  Object.assign(global, { window, document: window.document, HTMLElement: window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
  const observers = [];
  const playbackEvents = [];
  global.IntersectionObserver = class {
    constructor(cb) { this.cb = cb; this.disconnected = false; observers.push(this); }
    observe(video) { this.video = video; }
    disconnect() { this.disconnected = true; }
    visible(visible) { if (!this.disconnected) this.cb([{ isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]); }
  };
  window.HTMLMediaElement.prototype.play = function () {
    playbackEvents.push(`play:${this.getAttribute('src')}`);
    if (this.rejectNext) { this.rejectNext = false; return Promise.reject(new Error('NotAllowedError')); }
    if (this.deferNext) {
      this.deferNext = false;
      return new Promise(resolve => { this.finishPlay = () => { this.isPlaying = true; resolve(); }; });
    }
    this.isPlaying = true;
    return Promise.resolve();
  };
  window.HTMLMediaElement.prototype.pause = function () {
    playbackEvents.push(`pause:${this.getAttribute('src')}`);
    this.isPlaying = false;
  };
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-live-carousel-dom-'));
  try {
    await build({ stdin: { contents: `
      import React, { act } from 'react'; import { createRoot } from 'react-dom/client';
      import { PostMediaCarousel } from './packages/app/components/feed/post-media-carousel.web';
      import { Lightbox } from './packages/app/components/lightbox.web';
      import { useStoryViewerStore } from './packages/app/lib/stores/story-viewer-store';
      import { useLightboxStore } from './packages/app/lib/stores/lightbox-store';
      import { useCarouselStore } from './packages/app/lib/stores/carousel-store';
      export { act, useStoryViewerStore, useLightboxStore, useCarouselStore };
      export function mount(node) { const root = createRoot(node); return {
        render: (id,media) => root.render(<React.StrictMode><PostMediaCarousel key={id} media={media} caption="Carousel test"/><Lightbox/></React.StrictMode>),
        unmount: () => root.unmount(),
      }; }
    `, resolveDir: root, loader: 'tsx' }, bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic', outfile: path.join(dir, 'fixture.cjs'), alias: { '@dvnt/app': path.join(root, 'packages/app') }, nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean) });
    const { act, mount, useStoryViewerStore, useLightboxStore, useCarouselStore } = require(path.join(dir, 'fixture.cjs'));
    const node = document.createElement('div'); document.body.append(node);
    const app = mount(node);
    const media = [0, 1, 2, 3].map(i => ({ type: 'livePhoto', url: `still-${i}.jpg`, livePhotoVideoUrl: `motion-${i}.mp4` }));
    const videos = () => [...node.querySelectorAll('[data-post-motion]')];
    const visible = async value => act(async () => observers.forEach(o => o.visible(value)));
    const expectActive = index => assert.deepEqual(videos().map(v => !!v.isPlaying), media.map((_, i) => i === index));
    const swipe = async index => act(async () => {
      const carousel = node.querySelector('[data-post-media-carousel]');
      Object.defineProperty(carousel, 'clientWidth', { configurable: true, value: 400 });
      carousel.scrollLeft = index * 400;
      carousel.dispatchEvent(new window.Event('scroll', { bubbles: true }));
    });
    const hidden = async value => act(async () => {
      Object.defineProperty(document, 'hidden', { configurable: true, value });
      document.dispatchEvent(new window.Event('visibilitychange'));
    });

    useCarouselStore.getState().setIndex(3, 'an-old-post');
    await act(async () => app.render('first-post', media));
    assert.equal(videos().length, 4);
    assert.ok(videos().every(v => !v.isPlaying), 'nothing autoplays before visibility');
    assert.ok(videos().every((v, i) => v.getAttribute('src') === `motion-${i}.mp4` && v.getAttribute('poster') === `still-${i}.jpg`));
    assert.ok(videos().every(v => v.muted && v.loop && v.hasAttribute('playsinline')));
    await visible(true); expectActive(0);
    // Deliberately report ALL slides visible. Active selection, not merely
    // intersection, must prevent two clips during a swipe transition.
    await swipe(1); expectActive(1);
    playbackEvents.length = 0;
    await swipe(0); expectActive(0);
    assert.ok(playbackEvents.indexOf('pause:motion-1.mp4') < playbackEvents.indexOf('play:motion-0.mp4'), 'reverse swipe pauses the outgoing clip before starting the incoming clip');
    await swipe(1); expectActive(1);
    await visible(false);
    videos()[1].deferNext = true;
    await visible(true);
    const pending = videos()[1];
    await swipe(0); expectActive(0);
    await act(async () => pending.finishPlay());
    expectActive(0); assert.equal(pending.isPlaying, false, 'late play completion cannot resurrect the outgoing clip');
    await swipe(3); expectActive(3);
    await swipe(0); expectActive(0);
    await swipe(99); expectActive(3);
    await swipe(-1); expectActive(0);
    await visible(false); expectActive(-1);
    await visible(true); expectActive(0);
    await hidden(true); expectActive(-1);
    await hidden(false); expectActive(0);
    await act(async () => useStoryViewerStore.setState({ open: true })); expectActive(-1);
    await act(async () => useStoryViewerStore.setState({ open: false })); expectActive(0);

    await swipe(2); expectActive(2);
    await act(async () => videos()[2].closest('button').click());
    expectActive(-1);
    assert.equal(useLightboxStore.getState().items[2].livePhotoVideoUrl, 'motion-2.mp4');
    let overlay = document.querySelector('[role="dialog"] video');
    assert.equal(overlay.getAttribute('src'), 'motion-2.mp4');
    await visible(true); assert.equal(overlay.isPlaying, true); expectActive(-1);
    await act(async () => useLightboxStore.getState().next());
    assert.equal(overlay.isPlaying, false, 'old fullscreen clip is paused before replacement');
    overlay = document.querySelector('[role="dialog"] video');
    assert.equal(overlay.getAttribute('src'), 'motion-3.mp4');
    await visible(true); assert.equal(overlay.isPlaying, true); expectActive(-1);
    await hidden(true); assert.equal(overlay.isPlaying, false); expectActive(-1);
    await hidden(false); assert.equal(overlay.isPlaying, true); expectActive(-1);
    playbackEvents.length = 0;
    await act(async () => useLightboxStore.getState().close());
    assert.ok(playbackEvents.indexOf('pause:motion-3.mp4') < playbackEvents.indexOf('play:motion-2.mp4'), 'closing fullscreen pauses the overlay before resuming the underlying carousel');
    assert.equal(overlay.isPlaying, false); expectActive(2);

    await act(async () => app.render('second-post', media));
    await visible(true); expectActive(0);
    await swipe(1); expectActive(1);
    const replaced = videos()[1];
    const updated = media.map((m, i) => i === 1 ? { ...m, livePhotoVideoUrl: 'repaired.mp4' } : m);
    await act(async () => app.render('second-post', updated));
    assert.equal(replaced.isPlaying, false);
    await visible(true); expectActive(1);
    assert.equal(videos()[1].getAttribute('src'), 'repaired.mp4');

    // Native browser restrictions still get a real user-gesture retry.
    await visible(false);
    videos()[1].rejectNext = true;
    await visible(true);
    assert.ok(node.querySelector('[aria-label="Play video"]'));
    await act(async () => node.querySelector('[aria-label="Play video"]').click());
    expectActive(1);
    assert.equal(node.querySelector('[aria-label="Play video"]'), null);

    await act(async () => app.render('missing-pairs', media.map(({ livePhotoVideoUrl, ...m }) => m)));
    assert.equal(videos().length, 0, 'missing clips remain still images, not invented video URLs');
    assert.equal(node.querySelectorAll('img').length, 4);
    await act(async () => app.render('mixed', [media[0], { type: 'image', url: 'image.jpg' }, { type: 'gif', url: 'motion.gif' }, { type: 'animated_video', url: 'animated.mp4' }]));
    await visible(true);
    assert.deepEqual(videos().map(v => !!v.isPlaying), [true, false]);
    await swipe(1); assert.ok(videos().every(v => !v.isPlaying));
    await swipe(2); assert.ok(videos().every(v => !v.isPlaying));
    assert.equal(node.querySelectorAll('img')[1].getAttribute('src'), 'motion.gif');
    await swipe(3); assert.deepEqual(videos().map(v => !!v.isPlaying), [false, true]);
    const detached = videos();
    await act(async () => app.unmount());
    assert.ok(detached.every(v => !v.isPlaying));
    assert.ok(observers.every(o => o.disconnected));
    console.log('PASS actual web carousel/lightbox: first autoplay, selected-only swipes, pause offscreen/background/story/lightbox, new post reset, pair replacement, muted inline loop, blocked retry, missing pairs and mixed media (mocked media/viewport).');
  } finally {
    window.happyDOM.abort(); fs.rmSync(dir, { recursive: true, force: true });
  }
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
