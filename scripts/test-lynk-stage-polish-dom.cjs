#!/usr/bin/env node
// Production tiles/gallery with real React refs and synthetic media. This is
// an interaction/ownership check, not real-device or pixel acceptance.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const dependencyPaths = [root, ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)];
const resolve = name => require.resolve(name, { paths: dependencyPaths });

(async () => {
  const { Window } = await import(resolve('happy-dom'));
  const { build } = require(resolve('esbuild'));
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
    if (this.hasAttribute('data-room-stage')) return { x: 0, y: 0, left: 0, top: 0, width, height, right: width, bottom: height };
    if (this.hasAttribute('data-tile')) return { x: 0, y: 0, left: 0, top: 0, width: 191, height: 101, right: 191, bottom: 101 };
    return originalRect.call(this);
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lynk-stage-polish-'));
  let fixture, renderer;
  try {
    await build({
      stdin: { loader: 'tsx', resolveDir: root, contents: `
        import React, { act } from 'react'; import { createRoot } from 'react-dom/client';
        import { RoomStage } from './packages/app/features/sneaky-lynk/ui/web/RoomStage';
        export { act };
        export const attachments = [];
        const attachCanvas = (key, element) => attachments.push({ key, attached: !!element });
        export const stream = new window.MediaStream();
        export const tile = (key, isLocal = false) => ({ key, name: key, isHost: isLocal, isLocal, isCoHost: false,
          isCameraOn: true, isMicOn: false, videoStream: isLocal ? stream : null,
          canvasPath: isLocal ? undefined : key, attachCanvas });
        export function mount(node) { const root = createRoot(node); return { render: tiles => root.render(<RoomStage tiles={tiles} />), unmount: () => root.unmount() }; }
      ` },
      bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
      tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
      alias: { '@dvnt/app': path.join(root, 'packages/app'), 'react': path.dirname(resolve('react/package.json')), 'react-dom': path.dirname(resolve('react-dom/package.json')) },
      nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
      outfile: path.join(dir, 'fixture.cjs'),
    });
    fixture = require(path.join(dir, 'fixture.cjs'));
    const { act, tile, attachments, stream } = fixture;
    const node = document.createElement('div'); document.body.append(node);
    renderer = fixture.mount(node);
    const host = tile('host', true), guests = Array.from({ length: 9 }, (_, index) => tile(`guest-${index + 1}`));
    const card = key => node.querySelector(`[data-stage-card="${key}"]`);
    const scroller = () => node.querySelector('[data-stage-scroll]');
    const button = label => [...node.querySelectorAll('button')].find(element => element.getAttribute('aria-label') === label);
    const click = label => act(async () => { assert.ok(button(label), label); button(label).click(); });
    const key = value => act(async () => scroller().dispatchEvent(new window.KeyboardEvent('keydown', { key: value, bubbles: true })));
    const render = tiles => act(async () => renderer.render(tiles));
    await render([host, ...guests]);
    const hostVideo = card('host').querySelector('video'), guestCanvas = card('guest-1').querySelector('canvas');
    const mounted = attachments.length;
    assert.equal(hostVideo.srcObject, stream);
    assert.equal(guestCanvas.style.objectFit, 'cover', 'fill remains the default');

    for (const name of ['host', 'guest-1']) {
      const fit = button(`Fit ${name}'s full video`);
      assert.ok(fit.className.includes('h-11') && fit.className.includes('w-11'), 'framing target is 44px');
      assert.equal(fit.getAttribute('aria-pressed'), 'false');
      await click(`Fit ${name}'s full video`);
      assert.equal(fit.getAttribute('aria-pressed'), 'true');
      assert.equal(card(name).querySelector('[data-tile]').dataset.videoFit, 'contain');
      assert.match(fit.title, /only changes your view/);
    }
    assert.equal(guestCanvas.style.objectFit, 'contain');
    assert.ok(hostVideo.className.includes('object-contain'));
    assert.equal(card('host').querySelector('video'), hostVideo);
    assert.equal(hostVideo.srcObject, stream, 'fitting the local preview never rebinds capture');
    assert.equal(card('guest-1').querySelector('canvas'), guestCanvas);
    assert.equal(attachments.length, mounted, 'fitting must never detach or replace remote audio/video');

    for (const angle of [90, 180, 270, 0]) {
      await click("Rotate guest-1's video clockwise");
      assert.equal(card('guest-1').querySelector('[data-tile]').dataset.videoRotation, String(angle));
      assert.equal(guestCanvas.style.objectFit, 'contain', 'rotation preserves the viewer framing preference');
      assert.equal(guestCanvas.style.width, angle % 180 ? '101px' : '100%');
    }
    assert.ok(button("Rotate guest-1's video clockwise").className.includes('h-11'));
    assert.equal(node.querySelectorAll('[aria-label$=" is muted"]').length, 1, 'discovery cannot invent remote mute state');
    assert.ok(card('host').querySelector('[aria-label="host is muted"]'));

    await render([host, { ...guests[0], isCameraOn: false, isSpeaking: true }, ...guests.slice(1)]);
    assert.equal(card('guest-1').querySelector('canvas'), guestCanvas);
    assert.equal(guestCanvas.style.opacity, '0', 'no stale remote frame when video becomes unavailable');
    assert.match(card('guest-1').textContent, /No video/);
    assert.ok(card('guest-1').querySelector('[aria-label="guest-1 is speaking"]'));
    assert.equal(button("Fit guest-1's full video"), undefined);
    assert.equal(attachments.length, mounted, 'no-video and speaking state keep receiving audio');
    await render([host, ...guests]);
    assert.equal(guestCanvas.style.opacity, '1');
    assert.equal(guestCanvas.style.objectFit, 'contain');
    await click("Fit guest-1's full video");
    assert.equal(guestCanvas.style.objectFit, 'cover');

    assert.match(document.getElementById(scroller().getAttribute('aria-describedby')).textContent, /Audio continues/);
    assert.match(scroller().getAttribute('aria-keyshortcuts'), /Home End/);
    await key('End'); assert.equal(scroller().dataset.stagePage, '2');
    await key('Home'); assert.equal(scroller().dataset.stagePage, '0');
    button('Focus guest-1').focus();
    await act(async () => { scroller().scrollLeft = 390; scroller().dispatchEvent(new window.Event('scroll')); });
    assert.equal(document.activeElement, scroller(), 'swiping never strands keyboard focus in an inert card');
    assert.equal(card('guest-1').getAttribute('aria-hidden'), 'true');
    await key('Home');
    await click('Focus guest-1');
    assert.equal(button('Unpin guest-1').getAttribute('aria-pressed'), 'true');
    assert.match(button('Unpin guest-1').textContent, /Pinned for you/);
    await click('Unpin guest-1');
    assert.equal(card('host').dataset.focused, 'true');
    assert.equal(document.activeElement, scroller());
    assert.equal(button('Focus host').getAttribute('aria-pressed'), 'false', 'automatic host view is not a user pin');
    assert.equal(card('guest-1').querySelector('canvas'), guestCanvas);
    assert.equal(card('host').querySelector('video'), hostVideo);
    assert.equal(attachments.length, mounted, 'framing, rotation, paging and pin toggles preserve every player');

    await act(async () => { width = 320; height = 360; for (const observer of observers) observer.callback(); });
    assert.equal(card('guest-1').querySelector('canvas'), guestCanvas);
    await render([{ ...host, isCameraOn: false }, ...guests]);
    assert.match(card('host').textContent, /Camera off/);
    console.log('PASS stage polish: fit/fill + rotation preserve source/ref identity, truthful media states, 44px controls, explicit pin/unpin, page keyboard hints and focus recovery. Device/browser pixel acceptance remains deferred.');
  } finally {
    if (renderer) await fixture.act(async () => renderer.unmount());
    await window.happyDOM.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
