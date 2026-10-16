/** Diagnostic only. Generated pixels, no cameras, permissions, relay or tokens. */
const assert = require('node:assert/strict');
const http = require('node:http');
const dependencyPaths = [process.env.LYNK_PROBE_DEPS || process.cwd()];
const dependency = name => require(require.resolve(name, {paths: dependencyPaths}));
const { chromium } = dependency('playwright');
const { build } = dependency('esbuild');
const path = require('node:path');
const helperPath = path.join(path.dirname(require.resolve('@moq/publish', {paths: dependencyPaths})), 'video/normalize-orientation.js');
const stagePath = path.join(__dirname, '../packages/app/features/sneaky-lynk/ui/web/room-stage.tsx');
(async () => {
const sdk = (await build({ plugins: [{ name: 'stage-presentation-adapters', setup(builder) {
  builder.onResolve({ filter: /^(react|react-dom)(\/.*)?$/ }, args => ({path: require.resolve(args.path, {paths: dependencyPaths})}));
  builder.onResolve({ filter: /^(lucide-react|\.\/room-panels)$/ }, args => ({ path: args.path, namespace: 'stage-stub' }));
  builder.onLoad({ filter: /.*/, namespace: 'stage-stub' }, args => ({ contents: args.path === 'lucide-react'
    ? 'export const Crown=()=>null,Hand=()=>null,Mic=()=>null,MicOff=()=>null,RotateCw=()=>null,Zap=()=>null;'
    : 'export const SquareAvatar=()=>null;', loader: 'js' }));
} }], nodePaths: [path.join(process.env.LYNK_PROBE_DEPS || process.cwd(), 'node_modules')], jsx: 'automatic', stdin: { contents: `import * as Publish from "@moq/publish"; import {createOrientationNormalizer} from ${JSON.stringify(helperPath)}; window.Publish = Publish; window.createOrientationNormalizer = createOrientationNormalizer;
import React from "react"; import {createRoot} from "react-dom/client";
import {StageTile} from ${JSON.stringify(stagePath)};
window.mountStage = (container, tiles) => {
 const root = createRoot(container);
 const render = (next) => root.render(React.createElement(React.Fragment, null, ...next.map(tile => React.createElement(StageTile, {key:tile.key,tile}))));
 render(tiles); return {render,unmount:()=>root.unmount()};
};`, resolveDir: process.env.LYNK_PROBE_DEPS || process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser' })).outputFiles[0].text;
  const server = http.createServer((_q, r) => r.end('<html></html>')).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    page.on('console', message => console.log('browser:', message.text()));
    page.on('pageerror', error => console.error('browser error:', error));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.addScriptTag({ content: sdk });
    const results = await page.evaluate(async () => {
      const { Video, Signals } = window.Publish;
      const canvas = new OffscreenCanvas(64, 32);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 32, 16);
      ctx.fillStyle = 'lime'; ctx.fillRect(32, 0, 32, 16);
      ctx.fillStyle = 'blue'; ctx.fillRect(0, 16, 32, 16);
      ctx.fillStyle = 'yellow'; ctx.fillRect(32, 16, 32, 16);
      const rows = [];
      const normalize = window.createOrientationNormalizer();
      const avcSupport = await VideoEncoder.isConfigSupported({ codec: 'avc1.42001f', width: 64, height: 32, avc: { format: 'annexb' }, hardwareAcceleration: 'prefer-software' });
      const codec = avcSupport.supported ? 'avc1' : 'vp8';
      // Hosted Chromium may lack AVC. VP8 still exercises the same SDK catalog
      // and WebCodecs orientation contract; never label that an AVC reproduction.
      const encode = async (frame, config, catalog) => {
        let chunk, metadata;
        const encoder = new VideoEncoder({ output: (c, m) => { chunk = c; metadata = m; }, error: e => { throw e; } });
        encoder.configure(config); encoder.encode(frame, { keyFrame: true }); await encoder.flush(); encoder.close();
        const decode = async (config) => {
          let frame;
          const decoder = new VideoDecoder({ output: f => { frame = f; }, error: e => { throw e; } });
          decoder.configure(config); decoder.decode(chunk); await decoder.flush();
          const rendered = document.createElement("canvas"); rendered.width = frame.displayWidth; rendered.height = frame.displayHeight;
          const pixels = rendered.getContext('2d'); pixels.drawImage(frame, 0, 0);
          const corners = [[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([x,y]) => {
            const rgba = pixels.getImageData(Math.floor(x * rendered.width), Math.floor(y * rendered.height), 1, 1).data;
            if (rgba[0] > 128 && rgba[1] > 128) return 'Y';
            return rgba[0] > rgba[1] && rgba[0] > rgba[2] ? 'R' : rgba[1] > rgba[2] ? 'G' : 'B';
          }).join('');
          const result = { rotation: frame.rotation ?? 0, width: frame.displayWidth, height: frame.displayHeight, corners, dataUrl: rendered.toDataURL() };
          frame.close(); decoder.close(); return result;
        };
        return { metadata: metadata.decoderConfig, preserved: await decode(metadata.decoderConfig), catalog: await decode(catalog) };
      };
      for (const rotation of [0, 90, 180, 270]) for (const flip of [false, true]) {
        const frame = new VideoFrame(canvas, { timestamp: 0, rotation, flip });
        if (frame.rotation !== rotation) throw new Error('Browser does not implement VideoFrame rotation');
        // Resolve exactly the locked SDK's encoder/catalog configuration; no transport.
        const sdkEncoder = new Video.Encoder(new Signals.Signal(frame), new Signals.Signal({ getSettings: () => ({ frameRate: 30 }) }), new Signals.Signal(undefined), { enabled: true, config: { codec } });
        for (let n = 0; (!sdkEncoder.resolved.peek() || !sdkEncoder.catalog.peek()) && n < 100; n++) await new Promise(r => setTimeout(r, 20));
        const config = sdkEncoder.resolved.peek(); const catalog = sdkEncoder.catalog.peek();
        if (!config || !catalog) throw new Error('SDK failed to resolve selected codec config');
        const wire = await encode(frame, config, catalog);
        // Exercise the actual installed package patch, including the no-op path.
        const normalized = normalize(new VideoFrame(frame));
        const normalizedWire = await encode(normalized, { ...config, width: normalized.codedWidth, height: normalized.codedHeight }, { ...catalog, codedWidth: normalized.codedWidth, codedHeight: normalized.codedHeight });
        rows.push({ rotation, flip, input: { width: frame.displayWidth, height: frame.displayHeight }, sdkCatalog: catalog, wire, normalized: normalizedWire.catalog });
        normalized.close(); frame.close(); sdkEncoder.close();
      }
      // Exercise the patched SDK's real TrackProcessor boundary and source
      // teardown, replacing only capture with a generated-frame stream.
      const NativeProcessor = window.MediaStreamTrackProcessor;
      let capture, cancelled = false;
      window.MediaStreamTrackProcessor = class {
        constructor() { this.readable = new ReadableStream({ start(controller) { capture = controller; }, cancel() { cancelled = true; } }); }
      };
      let root;
      const pipeline = [];
      try {
        root = new Video.Root({ source: { getSettings: () => ({ frameRate: 30 }) } });
        for (let n = 0; !capture && n < 100; n++) await new Promise(r => setTimeout(r, 10));
        if (!capture) throw new Error('SDK capture boundary did not start');
        for (const rotation of [90, 0, 270, 180]) {
          const previous = root.frame.peek();
          const raw = new VideoFrame(canvas, { timestamp: rotation + pipeline.length * 1000, rotation, flip: true });
          capture.enqueue(raw);
          for (let n = 0; root.frame.peek() === previous && n < 100; n++) await new Promise(r => setTimeout(r, 10));
          const displayed = root.frame.peek();
          if (!displayed || displayed === previous) throw new Error('SDK did not deliver normalized frame');
          pipeline.push({ rotation: displayed.rotation, flip: displayed.flip, width: displayed.displayWidth, height: displayed.displayHeight, rawClosed: raw.displayWidth === 0, previousClosed: !previous || previous.displayWidth === 0 });
        }
        const last = root.frame.peek(); root.close(); root = null;
        for (let n = 0; !cancelled && n < 100; n++) await new Promise(r => setTimeout(r, 10));
        if (!cancelled || last.displayWidth !== 0) throw new Error('SDK teardown did not cancel capture and close last frame');
      } finally { root?.close(); window.MediaStreamTrackProcessor = NativeProcessor; }
      // Force the actual SDK fallback with a generated canvas track. Simulate
      // metadata-before-frame and one transient constructor race, then recover.
      const source = document.createElement('canvas'); source.width = 32; source.height = 64;
      source.getContext('2d').fillRect(0, 0, 32, 64);
      const stream = source.captureStream(30);
      const NativeFrame = window.VideoFrame;
      const createElement = document.createElement.bind(document);
      let fallbackVideo, waiting = true, attempts = 0, fallbackRoot;
      let fallbackResult;
      window.MediaStreamTrackProcessor = undefined;
      document.createElement = function(name, ...args) {
        const element = createElement(name, ...args);
        if (name === 'video') {
          fallbackVideo = element;
          const state = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'readyState').get;
          Object.defineProperty(element, 'readyState', { get: () => waiting ? 1 : state.call(element) });
        }
        return element;
      };
      window.VideoFrame = class extends NativeFrame {
        constructor(input, init) {
          if (input === fallbackVideo && ++attempts === 1) throw new DOMException('Video element has no video frame', 'InvalidStateError');
          super(input, init);
        }
      };
      try {
        fallbackRoot = new Video.Root({ source: stream.getVideoTracks()[0] });
        await new Promise(r => setTimeout(r, 150));
        if (!fallbackVideo || attempts || fallbackRoot.frame.peek()) throw new Error('Fallback captured before current frame readiness');
        waiting = false;
        for (let n = 0; !fallbackRoot.frame.peek() && n < 200; n++) await new Promise(r => setTimeout(r, 10));
        const frame = fallbackRoot.frame.peek();
        if (!frame || attempts < 2) throw new Error('Fallback did not recover transient no-video-frame error');
        fallbackResult = { rotation: frame.rotation ?? 0, width: frame.displayWidth, height: frame.displayHeight };
        fallbackRoot.close(); fallbackRoot = null;
        const count = attempts;
        await new Promise(r => setTimeout(r, 100));
        if (fallbackVideo.srcObject !== null || attempts !== count || frame.displayWidth !== 0) throw new Error('Fallback teardown left capture running');
        if (stream.getVideoTracks()[0].readyState !== 'live') throw new Error('Fallback stopped caller-owned track');
      } finally {
        fallbackRoot?.close(); window.MediaStreamTrackProcessor = NativeProcessor;
        window.VideoFrame = NativeFrame; document.createElement = createElement;
        stream.getTracks().forEach(t => t.stop());
      }
      return { userAgent: navigator.userAgent, avcSupported: !!avcSupport.supported, exercisedCodec: codec, rows, pipeline, fallback: fallbackResult };
    });
    console.log(JSON.stringify(results, (key, value) => key === "dataUrl" ? "[generated frame pixels]" : value, 2));
    for (const row of results.rows) {
      let expectedCorners = { 0: 'RGBY', 90: 'BRYG', 180: 'YBGR', 270: 'GYRB' }[row.rotation];
      if (row.flip) expectedCorners = expectedCorners[1] + expectedCorners[0] + expectedCorners[3] + expectedCorners[2];
      assert.equal(row.wire.preserved.rotation, row.rotation);
      assert.equal(row.wire.preserved.corners, expectedCorners);
      assert.equal(row.wire.catalog.corners, 'RGBY', 'Raw encoded pixels retain sensor orientation');
      assert.equal(row.normalized.corners, expectedCorners, 'Rasterized control must preserve displayed pixels');
      assert.equal(row.wire.catalog.rotation, 0, 'Reproduce catalog losing raw-frame rotation');
      assert.equal(row.normalized.rotation, 0);
      assert.equal(row.normalized.width, row.input.width);
      assert.equal(row.normalized.height, row.input.height);
    }
    // Mount the real remote browser tile. Only transport attachment and icons
    // are adapted; frames are the real encoded/decoded outputs from above.
    await page.addStyleTag({ content: `body{margin:0} #stage{display:flex;gap:12px} [data-tile]{position:relative;overflow:hidden;flex:none;border:0;border-radius:0} [data-tile] canvas{position:absolute} [data-tile] button{position:absolute;right:0;top:0;width:24px;height:24px;z-index:10}` });
    await page.evaluate(() => {
      const host = document.createElement('div'); host.id = 'stage'; document.body.appendChild(host);
      window.attachments = [];
      window.attachFrame = (path, canvas) => {
        window.attachments.push({path, attached:!!canvas});
        if (canvas) window.remoteCanvas = canvas;
      };
      window.remoteTile = {key:'guest',name:'Guest',isLocal:false,isHost:false,isCoHost:false,isCameraOn:true,isMicOn:true,isSpeaking:false,videoStream:null,canvasPath:'generated/guest',attachCanvas:window.attachFrame};
      window.stageRoot = window.mountStage(host, [window.remoteTile, {...window.remoteTile,key:'other',name:'Other',canvasPath:'generated/other',attachCanvas:()=>{}}]);
    });
    await page.waitForSelector('[data-tile="guest"] canvas');
    for (const row of results.rows) {
      await page.evaluate(async (frame) => {
        const tile = document.querySelector('[data-tile="guest"]');
        tile.style.width = `${frame.width * 4}px`; tile.style.height = `${frame.height * 4}px`;
        const other = document.querySelector('[data-tile="other"]'); other.style.width='128px'; other.style.height='128px';
        const image = new Image(); image.src = frame.dataUrl; await image.decode();
        const canvas = tile.querySelector('canvas'); canvas.width=frame.width; canvas.height=frame.height;
        canvas.getContext('2d').drawImage(image,0,0);
      }, row.normalized);
      const png = await page.locator('[data-tile="guest"]').screenshot();
      const corners = await page.evaluate(async (base64) => {
        const image = new Image(); image.src='data:image/png;base64,'+base64; await image.decode();
        const canvas=document.createElement('canvas');canvas.width=image.width;canvas.height=image.height;
        const ctx=canvas.getContext('2d');ctx.drawImage(image,0,0);
        return [[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([x,y])=>{
          const p=ctx.getImageData(Math.floor(x*canvas.width),Math.floor(y*canvas.height),1,1).data;
          return p[0]>128&&p[1]>128?'Y':p[0]>p[1]&&p[0]>p[2]?'R':p[1]>p[2]?'G':'B';
        }).join('');
      }, png.toString('base64'));
      assert.equal(corners,row.normalized.corners,'production remote tile preserves decoded orientation without additional rotation');
    }
    const before = await page.evaluate(()=>window.attachments.length);
    await page.getByRole('button',{name:"Rotate Guest's video clockwise"}).click();
    assert.equal(await page.locator('[data-tile="guest"]').getAttribute('data-video-rotation'),'90');
    assert.equal(await page.locator('[data-tile="other"]').getAttribute('data-video-rotation'),'0');
    await page.evaluate(()=>{document.querySelector('[data-tile="guest"]').style.width='200px';});
    await page.waitForTimeout(50);
    assert.equal(await page.locator('[data-tile="guest"]').getAttribute('data-video-rotation'),'90','resize must not rotate participant');
    assert.equal(await page.evaluate(()=>window.attachments.length),before,'manual rotation/resize must not reconnect media');
    await page.evaluate(()=>window.stageRoot.render([{...window.remoteTile,canvasPath:'generated/new-guest'}]));
    await page.waitForFunction(()=>document.querySelector('[data-tile="guest"]')?.dataset.videoRotation==='0');
    await page.evaluate(()=>window.stageRoot.unmount());
    console.log('Production remote StageTile: all eight decoded frame pixel cases, per-participant rotation, resize stability, path reset, and attachment stability passed. No relay or live account used.');
    for (const frame of results.pipeline) {
      assert.equal(frame.rotation, 0); assert.equal(frame.flip, false);
      assert.equal(frame.rawClosed, true); assert.equal(frame.previousClosed, true);
    }
    assert.deepEqual(results.fallback, { rotation: 0, width: 32, height: 64 });
    console.log('Actual SDK fallback passed delayed readiness, transient InvalidStateError recovery, and teardown with generated browser video.');
    console.log('Confirmed catalog metadata gap and installed normalization patch preserves all angle/flip pixels; generated video-element fallback remains upright. AVC/iPhone attribution remains unproven.');
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
