#!/usr/bin/env node
// Production web carousel + lightbox under React. Live Photos follow iOS: the
// still shows, nothing autoplays, hover (mouse) or press-and-hold (touch) plays
// the selected slide's clip from the start, and letting go returns to the still.
// Media/viewport are mocked; real decoding is covered by the browser companion.
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
  const proto = window.HTMLMediaElement.prototype;
  Object.defineProperty(proto, 'paused', { configurable: true, get() { return !this.isPlaying; } });
  Object.defineProperty(proto, 'currentTime', { configurable: true, get() { return this.time ?? 0; }, set(value) { this.time = value; } });
  const startPlaying = el => { el.isPlaying = true; el.dispatchEvent(new window.Event('playing')); };
  proto.play = function () {
    playbackEvents.push(`play:${this.getAttribute('src')}@${this.currentTime}`);
    if (this.rejectNext) { this.rejectNext = false; return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' })); }
    if (this.deferNext) {
      this.deferNext = false;
      return new Promise(resolve => { this.finishPlay = () => { startPlaying(this); resolve(); }; });
    }
    startPlaying(this);
    return Promise.resolve();
  };
  proto.pause = function () {
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
    window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
    const node = document.createElement('div'); document.body.append(node);
    const app = mount(node);
    const media = [0, 1, 2, 3].map(i => ({ type: 'livePhoto', url: `still-${i}.jpg`, livePhotoVideoUrl: `motion-${i}.mp4` }));
    const clips = () => [...node.querySelectorAll('[data-live-photo-motion]')];
    const stills = () => [...node.querySelectorAll('[data-live-photo] img')];
    const wait = ms => act(async () => new Promise(resolve => setTimeout(resolve, ms)));
    const visible = async value => act(async () => observers.forEach(o => o.visible(value)));
    const expectPlaying = index => assert.deepEqual(clips().map(v => !!v.isPlaying), media.map((_, i) => i === index));
    const pointer = (type, target, init) => target.dispatchEvent(new window.PointerEvent(type, { bubbles: true, cancelable: true, pointerId: 1, clientX: 10, clientY: 10, ...init }));
    // React builds onPointerEnter/Leave from pointerover/pointerout.
    const hover = async i => act(async () => pointer('pointerover', stills()[i], { pointerType: 'mouse', relatedTarget: null }));
    const unhover = async i => act(async () => pointer('pointerout', stills()[i], { pointerType: 'mouse', relatedTarget: document.body }));
    const press = async (target, ms, { click = true } = {}) => {
      await act(async () => pointer('pointerdown', target, { pointerType: 'touch' }));
      await wait(ms);
      await act(async () => pointer('pointerup', target, { pointerType: 'touch' }));
      if (click) await act(async () => target.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
    };
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
    const lastPlay = () => playbackEvents.filter(e => e.startsWith('play:')).at(-1);

    useCarouselStore.getState().setIndex(3, 'an-old-post');
    await act(async () => app.render('first-post', media));
    assert.equal(clips().length, 4);
    assert.equal(node.querySelectorAll('[data-post-motion]').length, 0, 'Live Photos are not autoplay feed videos');
    assert.ok(clips().every((v, i) => v.getAttribute('src') === `motion-${i}.mp4` && stills()[i].getAttribute('src') === `still-${i}.jpg`));
    assert.ok(clips().every(v => v.muted && !v.loop && !v.autoplay && v.hasAttribute('playsinline') && v.getAttribute('preload') === 'none'));
    assert.equal(node.querySelectorAll('button[aria-label="Live Photo"]').length, 4, 'every Live Photo slide has a LIVE badge');
    await visible(true); await wait(50);
    expectPlaying(-1);
    assert.equal(playbackEvents.length, 0, 'nothing autoplays when visible');

    // Hover plays the hovered, selected slide only, from the start; leaving pauses.
    await hover(0); expectPlaying(0);
    assert.equal(lastPlay(), 'play:motion-0.mp4@0');
    assert.equal(node.querySelectorAll('[data-live-photo]')[0].dataset.playing, 'true');
    await unhover(0); expectPlaying(-1);
    assert.equal(node.querySelectorAll('[data-live-photo]')[0].dataset.playing, undefined);
    await hover(1); expectPlaying(-1);
    assert.ok(!playbackEvents.some(e => e.startsWith('play:motion-1')), 'a neighbouring slide that is not selected never starts');
    await swipe(1); expectPlaying(1);
    assert.equal(lastPlay(), 'play:motion-1.mp4@0', 'the hovered slide plays once it becomes the selected one');
    clips()[1].currentTime = 2.5; await unhover(1); await hover(1);
    assert.equal(lastPlay(), 'play:motion-1.mp4@0', 'every hover replays from the start');

    // Swiping away from a playing slide pauses it before anything else starts.
    playbackEvents.length = 0;
    await swipe(0); expectPlaying(-1);
    assert.deepEqual(playbackEvents, ['pause:motion-1.mp4']);
    await unhover(1);
    await hover(0); expectPlaying(0);
    await unhover(0);

    // Hover then hold on the same slide is still one clip; release stops it.
    // (expectPlaying checks every step that no more than one clip runs.)
    await swipe(2); expectPlaying(-1);
    await hover(2); expectPlaying(2);
    await act(async () => pointer('pointerdown', stills()[2], { pointerType: 'touch' })); await wait(400);
    expectPlaying(2);
    await act(async () => pointer('pointerup', stills()[2], { pointerType: 'touch' })); expectPlaying(-1);
    await unhover(2);

    // A late play() resolution cannot resurrect the outgoing clip.
    await swipe(1);
    clips()[1].deferNext = true;
    await hover(1);
    const pending = clips()[1];
    await swipe(0); expectPlaying(-1);
    await act(async () => pending.finishPlay());
    assert.equal(!!pending.isPlaying, false, 'late play completion cannot resurrect the outgoing clip');
    expectPlaying(-1);
    await unhover(1);

    // Rapid hover in/out ends at the still, with no stale rejection clobbering a newer start.
    for (let i = 0; i < 5; i++) { await hover(0); await unhover(0); }
    expectPlaying(-1);
    await hover(0); expectPlaying(0);

    // A blocked play() leaves the still and the slide stays usable.
    await unhover(0);
    clips()[0].rejectNext = true;
    await hover(0); await wait(10);
    expectPlaying(-1);
    assert.equal(node.querySelectorAll('[data-live-photo]')[0].dataset.playing, undefined);
    await unhover(0); await hover(0); expectPlaying(0);

    // Background tab and story viewer pause, and block a new start while they own the screen.
    await hidden(true); expectPlaying(-1);
    await unhover(0); await hover(0); expectPlaying(-1);
    await hidden(false); await unhover(0); await hover(0); expectPlaying(0);
    await act(async () => useStoryViewerStore.setState({ open: true })); expectPlaying(-1);
    await unhover(0); await hover(0); expectPlaying(-1);
    await act(async () => useStoryViewerStore.setState({ open: false }));
    await unhover(0); await hover(0); expectPlaying(0);
    await unhover(0);

    // Keyboard: hold Enter on the focused badge.
    const badge0 = node.querySelectorAll('button[aria-label="Live Photo"]')[0];
    await act(async () => badge0.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })));
    expectPlaying(0);
    await act(async () => badge0.dispatchEvent(new window.KeyboardEvent('keyup', { key: 'Enter', bubbles: true, cancelable: true })));
    expectPlaying(-1);
    assert.equal(useLightboxStore.getState().open, false, 'the badge never opens the lightbox');

    // A quick tap opens the lightbox without playing; a hold plays and its release does not open.
    playbackEvents.length = 0;
    await press(stills()[0], 100);
    assert.equal(useLightboxStore.getState().open, true, 'a quick tap opens the lightbox');
    assert.equal(playbackEvents.filter(e => e.startsWith('play:')).length, 0, 'a quick tap does not play');
    await act(async () => useLightboxStore.getState().close());
    await press(stills()[0], 600, { click: false });
    assert.ok(playbackEvents.some(e => e === 'play:motion-0.mp4@0'), 'a hold plays');
    await act(async () => stills()[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true })));
    assert.equal(useLightboxStore.getState().open, false, 'releasing a hold that played does not open the lightbox');
    expectPlaying(-1);
    await press(stills()[0], 100);
    assert.equal(useLightboxStore.getState().open, true, 'the swallowed click is one-shot: the next tap opens');
    await act(async () => useLightboxStore.getState().close());

    // Lightbox: right clip, no autoplay, hold to play, replacement and background pause.
    await swipe(2); await hover(2); expectPlaying(2);
    await act(async () => stills()[2].closest('button').click());
    expectPlaying(-1);
    assert.equal(useLightboxStore.getState().items[2].livePhotoVideoUrl, 'motion-2.mp4');
    const overlayClip = () => document.querySelector('[role="dialog"] [data-live-photo-motion]');
    const overlayStill = () => document.querySelector('[role="dialog"] [data-live-photo] img');
    assert.equal(overlayClip().getAttribute('src'), 'motion-2.mp4');
    assert.equal(overlayStill().getAttribute('src'), 'still-2.jpg');
    assert.ok(document.querySelector('[role="dialog"] button[aria-label="Live Photo"]'));
    await visible(true); await wait(50);
    assert.equal(!!overlayClip().isPlaying, false, 'the lightbox Live Photo does not autoplay');
    await unhover(2); await hover(2); expectPlaying(-1);
    await act(async () => pointer('pointerdown', overlayStill(), { pointerType: 'touch' })); await wait(400);
    assert.equal(!!overlayClip().isPlaying, true, 'holding the lightbox Live Photo plays it');
    await act(async () => pointer('pointerup', overlayStill(), { pointerType: 'touch' }));
    assert.equal(!!overlayClip().isPlaying, false);
    await act(async () => pointer('pointerdown', overlayStill(), { pointerType: 'touch' })); await wait(400);
    const outgoing = overlayClip();
    await act(async () => useLightboxStore.getState().next());
    assert.equal(!!outgoing.isPlaying, false, 'old fullscreen clip is paused before replacement');
    assert.equal(overlayClip().getAttribute('src'), 'motion-3.mp4');
    assert.equal(!!overlayClip().isPlaying, false);
    await act(async () => pointer('pointerdown', overlayStill(), { pointerType: 'touch' })); await wait(400);
    assert.equal(!!overlayClip().isPlaying, true);
    await hidden(true); assert.equal(!!overlayClip().isPlaying, false);
    await hidden(false); assert.equal(!!overlayClip().isPlaying, false, 'returning to the tab does not resume on its own');
    await act(async () => pointer('pointercancel', overlayStill(), { pointerType: 'touch' }));
    await act(async () => useLightboxStore.getState().close());
    expectPlaying(-1);
    await unhover(2);

    // New post resets selection; a repaired pair replaces the clip and stops the old one.
    await act(async () => app.render('second-post', media));
    await swipe(1); await hover(1); expectPlaying(1);
    const replaced = clips()[1];
    playbackEvents.length = 0;
    await act(async () => app.render('second-post', media.map((m, i) => i === 1 ? { ...m, livePhotoVideoUrl: 'repaired.mp4' } : m)));
    assert.equal(!!replaced.isPlaying, false);
    assert.ok(playbackEvents.includes('pause:motion-1.mp4'));
    assert.equal(clips()[1].getAttribute('src'), 'repaired.mp4');
    expectPlaying(-1);
    await unhover(1); await hover(1); expectPlaying(1);
    assert.equal(lastPlay(), 'play:repaired.mp4@0');
    await unhover(1);

    await act(async () => app.render('missing-pairs', media.map(({ livePhotoVideoUrl, ...m }) => m)));
    assert.equal(clips().length, 0, 'missing clips remain still images, not invented video URLs');
    assert.equal(node.querySelectorAll('button[aria-label="Live Photo"]').length, 0, 'no badge without a clip');
    assert.equal(node.querySelectorAll('img').length, 4);

    // Mixed media: animated video keeps its visible autoplay; the Live Photo does not.
    await act(async () => app.render('mixed', [media[0], { type: 'image', url: 'image.jpg' }, { type: 'gif', url: 'motion.gif' }, { type: 'animated_video', url: 'animated.mp4' }]));
    await visible(true);
    const autoplay = () => [...node.querySelectorAll('[data-post-motion]')];
    assert.equal(clips().length, 1); assert.equal(autoplay().length, 1);
    assert.equal(!!clips()[0].isPlaying, false);
    assert.equal(node.querySelectorAll('img')[2].getAttribute('src'), 'motion.gif');
    await swipe(3); await visible(true);
    assert.equal(!!autoplay()[0].isPlaying, true); assert.equal(!!clips()[0].isPlaying, false);
    await swipe(0); assert.equal(!!autoplay()[0].isPlaying, false);
    await hover(0); assert.equal(!!clips()[0].isPlaying, true);
    const detached = [...clips(), ...autoplay()];
    await act(async () => app.unmount());
    assert.ok(detached.every(v => !v.isPlaying), 'unmount leaves nothing playing');
    assert.ok(observers.every(o => o.disconnected));
    console.log('PASS actual web carousel/lightbox Live Photos: no autoplay, hover plays the selected slide from 0 and leave pauses, swipe-away pause, one clip at a time, late play() cannot resurrect, rapid hover, blocked play, background/story pause, badge keyboard hold, quick tap opens without playing, hold plays and release does not open, lightbox right clip with no autoplay and hold-to-play, pair replacement, missing pairs, mixed media (mocked media/viewport).');
  } finally {
    window.happyDOM.abort(); fs.rmSync(dir, { recursive: true, force: true });
  }
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
