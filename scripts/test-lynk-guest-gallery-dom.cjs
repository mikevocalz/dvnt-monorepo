#!/usr/bin/env node
// Production web RoomStage + StageTile, with real React canvas refs. Measured
// sizes and scroll events are supplied by happy-dom; not a browser pixel test.
// Run: node scripts/test-lynk-guest-gallery-dom.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const dependencyPaths = [...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean), path.resolve(__dirname, '..')];
const resolveDependency = name => require.resolve(name, { paths: dependencyPaths });
const { build } = require(resolveDependency('esbuild'));

(async () => {
  const { Window } = await import(resolveDependency('happy-dom'));
  const window = new Window();
  const observers = new Set();
  let width = 390, height = 650;
  class ResizeObserver {
    constructor(callback) { this.callback = callback; observers.add(this); }
    observe() {}
    disconnect() { observers.delete(this); }
  }
  Object.assign(global, { window, document: window.document, Node: window.Node, HTMLElement: window.HTMLElement, ResizeObserver, IS_REACT_ACT_ENVIRONMENT: true });
  const originalRect = window.HTMLElement.prototype.getBoundingClientRect;
  window.HTMLElement.prototype.getBoundingClientRect = function () {
    if (this.hasAttribute('data-room-stage')) return { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height, toJSON() {} };
    return originalRect.call(this);
  };
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynk-guest-gallery-'));
  let fixture, renderer;
  try {
    await build({
      stdin: { loader: 'tsx', resolveDir: root, contents: `
        import React, { act } from 'react'; import { createRoot } from 'react-dom/client';
        import { RoomStage } from './packages/app/features/sneaky-lynk/ui/web/RoomStage';
        export { act };
        export const attachments = [];
        const attachCanvas = (key, element) => attachments.push({ key, attached: !!element });
        export const tile = (key, host = false) => ({ key, name: key, isHost: host, isLocal: host, isCoHost: key === 'guest-1', isCameraOn: true, isMicOn: true, videoStream: null, canvasPath: host ? undefined : key, attachCanvas });
        export function mount(node) { const root = createRoot(node); return { render: tiles => root.render(<RoomStage tiles={tiles} />), unmount: () => root.unmount() }; }
      ` },
      bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
      tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
      alias: { '@dvnt/app': path.join(root, 'packages/app'), 'react': path.dirname(resolveDependency('react/package.json')), 'react-dom': path.dirname(resolveDependency('react-dom/package.json')) },
      outfile: path.join(dir, 'fixture.cjs'),
      nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
    });
    fixture = require(path.join(dir, 'fixture.cjs'));
    const { act, tile, attachments } = fixture;
    const node = document.createElement('div'); document.body.append(node);
    renderer = fixture.mount(node);
    const host = tile('host', true), guest = tile('guest-1');
    const card = key => node.querySelector(`[data-stage-card="${key}"]`);
    const video = key => card(key).querySelector('canvas');
    const scroller = () => node.querySelector('[data-stage-scroll]');
    const button = label => [...node.querySelectorAll("button")].find(button => button.getAttribute("aria-label") === label);
    const render = tiles => act(async () => renderer.render(tiles));
    const resize = (w, h) => act(async () => { width = w; height = h; for (const observer of observers) observer.callback(); });
    const click = label => act(async () => { const target = button(label); assert.ok(target, label); target.click(); });
    const assertStacked = () => {
      assert.equal(card('host').dataset.focused, 'true', 'the host stays above even when input order puts a guest first');
      assert.equal(card('host').style.top, '0px');
      assert.ok(parseFloat(card('guest-1').style.top) >= parseFloat(card('host').style.height) + 8);
      assert.equal(card('host').style.width, card('guest-1').style.width);
      assert.ok(Math.abs(parseFloat(card('host').style.height) - parseFloat(card('guest-1').style.height)) <= 1);
    };

    await render([guest, host]);
    const guestCanvas = video('guest-1');
    assertStacked();
    await click("Rotate guest-1's video clockwise");
    assert.equal(card('guest-1').querySelector('[data-tile]').dataset.videoRotation, '90');
    for (const [w, h] of [[320, 360], [740, 180], [768, 700], [1440, 650], [390, 650]]) {
      await resize(w, h); assertStacked();
      assert.equal(video('guest-1'), guestCanvas, 'resizing must not detach media');
    }
    assert.deepEqual(attachments, [{ key: 'guest-1', attached: true }]);

    const guests = Array.from({ length: 9 }, (_, index) => index === 0 ? guest : tile(`guest-${index + 1}`));
    await render([host, ...guests]);
    assert.equal(scroller().dataset.stagePages, '3');
    assert.equal(card('guest-1').dataset.guestPage, '0');
    assert.equal(card('guest-5').dataset.guestPage, '1');
    assert.equal(card('guest-9').dataset.guestPage, '2');
    assert.equal(card('host').hasAttribute('inert'), false);
    assert.equal(card('guest-1').hasAttribute('inert'), false);
    assert.equal(card('guest-5').hasAttribute('inert'), true, 'inactive guest pages cannot receive keyboard focus');
    assert.equal(card('guest-5').getAttribute('aria-hidden'), 'true');
    assert.equal(video('guest-1'), guestCanvas, 'duo-to-group transition keeps the existing canvas');
    assert.equal(card('guest-1').querySelector('[data-tile]').dataset.videoRotation, '90');
    const canvasByKey = new Map(guests.map(guest => [guest.key, video(guest.key)]));
    const mounted = attachments.length;
    await act(async () => { scroller().scrollLeft = 200; scroller().dispatchEvent(new window.Event('scroll')); });
    assert.equal(scroller().dataset.stagePage, '1');
    assert.equal(scroller().scrollLeft, 200, 'tracking a partial swipe must not jump to a snap boundary mid-gesture');
    await click('Previous guest page');
    await click('Next guest page');
    assert.equal(scroller().dataset.stagePage, '1');
    assert.equal(scroller().scrollLeft, 390);
    assert.equal(card('guest-1').hasAttribute('inert'), true);
    assert.equal(card('guest-5').hasAttribute('inert'), false);
    await act(async () => { scroller().scrollLeft = 780; scroller().dispatchEvent(new window.Event('scroll')); });
    assert.equal(scroller().dataset.stagePage, '2', 'swiping updates the current page');
    assert.equal(button('Next guest page').disabled, true);
    await act(async () => scroller().dispatchEvent(new window.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })));
    assert.equal(scroller().dataset.stagePage, '1', 'keyboard paging is available');
    assert.equal(attachments.length, mounted, 'paging never unmounts offscreen audio/video');

    await click('Next guest page');
    await click('Focus guest-9');
    assert.equal(card('guest-9').dataset.focused, 'true');
    assert.equal(scroller().dataset.stagePage, '0');
    for (const guest of guests) assert.equal(video(guest.key), canvasByKey.get(guest.key), 'changing focus preserves canvas identity');
    assert.equal(attachments.length, mounted);
    await act(async () => [...node.querySelectorAll('button')].find(button => button.textContent === 'Reset focus').click());
    assert.equal(card('host').dataset.focused, 'true');
    assert.equal(attachments.length, mounted);

    await click('Next guest page'); await click('Next guest page');
    await render([host, ...guests.slice(0, 2)]);
    assert.equal(scroller().dataset.stagePage, '0', 'departing final page cannot leave a blank page');
    assert.equal(scroller().scrollLeft, 0);
    assert.equal(video('guest-1'), guestCanvas);
    assert.deepEqual(attachments.filter(entry => !entry.attached).map(entry => entry.key).sort(), guests.slice(2).map(guest => guest.key).sort());

    await click('Focus guest-2');
    await render([guest, host]);
    assertStacked();
    assert.equal(video('guest-1'), guestCanvas, 'focused guest leaving returns to stacked host without resetting survivors');
    await render([host]);
    assert.equal(node.querySelector('[data-stage-mode]').dataset.stageMode, 'solo');
    assert.equal(card('host').style.height, '650px');
    assert.equal(node.querySelectorAll('[data-stage-card]').length, 1);
    console.log('PASS web Zoom gallery: stacked duo across sizes, 2x2 guest pages, swipe/keyboard/buttons, stable video/audio mounts, rotation state, focus, join/leave and departed-page recovery.');
  } finally {
    if (renderer) await fixture.act(async () => renderer.unmount());
    await window.happyDOM.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
