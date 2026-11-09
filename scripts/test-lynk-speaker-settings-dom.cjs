// Actual speaker settings + session store in synthetic browsers. No physical
// devices, permission prompts, capture, live relay or authenticated account.
const assert = require('node:assert/strict');
const path = require('node:path');
const { build } = require('esbuild');
const { JSDOM } = require('jsdom');
(async () => {
  const bundle = await build({ stdin: { resolveDir: path.join(__dirname, '..'), loader: 'tsx', contents: `
    import React from 'react';import {createRoot} from 'react-dom/client';
    import {DeviceSelectors} from './packages/app/features/sneaky-lynk/ui/web/DeviceSelectors';
    import {useRoomUIStore} from './packages/app/features/sneaky-lynk/stores/room-ui-store';
    const root=createRoot(document.getElementById('root'));
    window.fixture={store:useRoomUIStore,render:()=>root.render(<details open><summary>Audio settings</summary><DeviceSelectors roomHasVideo={false}/></details>),hide:()=>root.render(null),unmount:()=>root.unmount()};
    window.fixture.render();
  ` }, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'react' } }, nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean), define: { 'process.env.NODE_ENV': '"test"' } });
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://localhost', runScripts: 'outside-only', pretendToBeVisual: true });
  const { window } = dom, errors = [], picks = [], writes = [], readiness = [];
  window.addEventListener('error', event => errors.push(event.message));
  let capture = 0, list = [{ kind: 'audioinput', deviceId: 'mic', label: 'Microphone' }, { kind: 'audiooutput', deviceId: 'usb', label: 'USB headphones' }];
  const media = new window.EventTarget();
  media.enumerateDevices = async () => list;
  media.getUserMedia = () => { capture++; throw new Error('speaker routing cannot capture'); };
  media.selectAudioOutput = () => new Promise((resolve, reject) => picks.push({ resolve, reject }));
  Object.defineProperty(window.navigator, 'mediaDevices', { configurable: true, value: media });
  // HTMLMediaElement support alone is not enough for the MoQ Web Audio path.
  window.HTMLMediaElement.prototype.setSinkId = async () => {};
  window.AudioContext = class {};
  const tick = () => new Promise(resolve => setTimeout(resolve, 10));
  const wait = async predicate => { for (let i = 0; i < 150; i++) { if (predicate()) return; await tick(); } throw new Error('Speaker settings did not settle'); };
  const body = () => window.document.body.textContent;
  const button = name => [...window.document.querySelectorAll('button')].find(button => button.textContent === name);
  const select = id => { const input = window.document.querySelector('select[id$="-audiooutput"]'); assert(input); input.value = id; input.dispatchEvent(new window.Event('change', { bubbles: true })); };
  try {
    window.eval(bundle.outputFiles[0].text); const f = window.fixture;
    await wait(() => /This browser can't route Lynk's audio/.test(body()));
    assert.equal(window.document.querySelector('select[id$="-audiooutput"]'), null);
    assert.equal(picks.length, 0); assert.equal(capture, 0);
    f.hide(); await tick(); f.store.getState().reset();
    window.AudioContext.prototype.setSinkId = async () => {};
    f.render(); await wait(() => window.document.querySelector('select[id$="-audiooutput"] option[value="usb"]'));
    assert.equal(picks.length, 0, 'mount never asks permission'); button('Refresh devices').click(); await tick(); assert.equal(picks.length, 0);
    select('usb'); await wait(() => /Routing will be checked when room audio starts/.test(body()));
    assert.equal(picks.length, 0, 'an already enumerated output uses no browser picker');
    assert.equal(f.store.getState().joinMicOn, true); assert.equal(f.store.getState().joinCameraOn, true); assert.equal(capture, 0);
    const context = { state: 'running', sinkId: '', setSinkId(id) { return new Promise((resolve, reject) => writes.push({ id, resolve: () => { this.sinkId = id; resolve(); }, reject })); } };
    const unregister = f.store.getState().audioOutput.register(context, ready => readiness.push(ready));
    await wait(() => writes.length === 1); assert.match(body(), /Switching room audio/); assert.equal(readiness.at(-1), false);
    assert.equal(window.document.querySelector('select[id$="-audiooutput"]').getAttribute('aria-busy'), 'true');
    writes[0].resolve(); await wait(() => /Room audio is routed to USB headphones/.test(body())); assert.equal(readiness.at(-1), true);
    button('Choose speaker or headphones').click(); await wait(() => picks.length === 1);
    assert.equal(button('Waiting for speaker choice…').disabled, true);
    picks[0].reject(Object.assign(new window.Error('private operating system detail'), { name: 'NotAllowedError' }));
    await wait(() => /canceled or not allowed/.test(body())); assert.equal(context.sinkId, 'usb'); assert.doesNotMatch(body(), /private operating system detail/);
    button('Choose speaker or headphones').click(); await wait(() => picks.length === 2);
    const details = window.document.querySelector('details'); details.open = false; await tick();
    picks[1].resolve({ deviceId: 'late', label: 'Late speakers' }); await tick(); assert.equal(f.store.getState().audioOutputState.deviceId, 'usb');
    details.open = true; await tick(); button('Choose speaker or headphones').click(); await wait(() => picks.length === 3);
    button('Use system default').click(); await wait(() => writes.length === 2);
    picks[2].resolve({ deviceId: 'late', label: 'Late speakers' }); await tick(); assert.equal(f.store.getState().audioOutputState.deviceId, '');
    writes[1].resolve(); await wait(() => /follows your system default/.test(body()));
    button('Choose speaker or headphones').click(); await wait(() => picks.length === 4); picks[3].resolve({ deviceId: 'usb', label: 'USB headphones' }); await wait(() => writes.length === 3);
    writes[2].resolve(); await wait(() => /Room audio is routed to USB headphones/.test(body()));
    list = list.filter(device => device.deviceId !== 'usb'); media.dispatchEvent(new window.Event('devicechange')); await wait(() => writes.length === 4);
    assert.match(body(), /Switching room audio/); assert.doesNotMatch(body(), /now using system default/);
    writes[3].resolve(); await wait(() => /disconnected.*now using system default/.test(body())); assert.equal(picks.length, 4, 'hotplug never prompts');
    button('Choose speaker or headphones').click(); await wait(() => picks.length === 5); f.hide(); await tick();
    picks[4].resolve({ deviceId: 'late', label: 'Late speakers' }); await tick(); assert.equal(f.store.getState().audioOutputState.deviceId, '');
    unregister(); f.store.getState().reset(); assert.equal(f.store.getState().audioOutputState.deviceId, '');
    // Browsers with setSinkId but no selectAudioOutput can choose already
    // available devices and accurately explain missing permission/inventory.
    delete media.selectAudioOutput; f.render(); await wait(() => /Only outputs already available/.test(body()));
    assert.equal(button('Choose speaker or headphones'), undefined); assert.equal(capture, 0);
    f.unmount(); assert.deepEqual(errors, []);
    console.log('PASS production speaker-settings DOM: Web Audio capability (not HTML-only), accessible pending/applied status, no passive prompt/capture, explicit chooser, cancellation/close/default/unmount guards, successful real-context sink changes, hotplug fallback after completion, reset and no-picker fallback. Synthetic hardware only.');
  } finally { dom.window.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
