/** Diagnostic only. Generated pixels, no cameras, permissions, relay or tokens. */
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');
const { buildSync } = require('esbuild');
const path = require('node:path');
const helperPath = path.join(path.dirname(require.resolve('@moq/publish')), 'video/normalize-orientation.js');
const sdk = buildSync({ stdin: { contents: `import * as Publish from "@moq/publish"; import {createOrientationNormalizer} from ${JSON.stringify(helperPath)}; window.Publish = Publish; window.createOrientationNormalizer = createOrientationNormalizer;`, resolveDir: process.env.LYNK_PROBE_DEPS || process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser' }).outputFiles[0].text;
(async () => {
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
          const rendered = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
          const pixels = rendered.getContext('2d'); pixels.drawImage(frame, 0, 0);
          const corners = [[.25,.25],[.75,.25],[.25,.75],[.75,.75]].map(([x,y]) => {
            const rgba = pixels.getImageData(Math.floor(x * rendered.width), Math.floor(y * rendered.height), 1, 1).data;
            if (rgba[0] > 128 && rgba[1] > 128) return 'Y';
            return rgba[0] > rgba[1] && rgba[0] > rgba[2] ? 'R' : rgba[1] > rgba[2] ? 'G' : 'B';
          }).join('');
          const result = { rotation: frame.rotation ?? 0, width: frame.displayWidth, height: frame.displayHeight, corners };
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
      // SDK's WebKit fallback constructs VideoFrame(video), not the raw track's
      // VideoFrame. Exercise that boundary with a generated canvas stream.
      const source = document.createElement('canvas'); source.width = 32; source.height = 64;
      source.getContext('2d').fillRect(0, 0, 32, 64);
      const stream = source.captureStream(1); const video = document.createElement('video');
      video.muted = true; video.playsInline = true; video.srcObject = stream;
      await video.play();
      const fallback = new VideoFrame(video, { timestamp: 0 });
      const fallbackResult = { rotation: fallback.rotation ?? 0, width: fallback.displayWidth, height: fallback.displayHeight };
      fallback.close(); video.pause(); video.srcObject = null; stream.getTracks().forEach(t => t.stop());
      return { userAgent: navigator.userAgent, avcSupported: !!avcSupport.supported, exercisedCodec: codec, rows, pipeline, fallback: fallbackResult };
    });
    console.log(JSON.stringify(results, null, 2));
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
    for (const frame of results.pipeline) {
      assert.equal(frame.rotation, 0); assert.equal(frame.flip, false);
      assert.equal(frame.rawClosed, true); assert.equal(frame.previousClosed, true);
    }
    assert.deepEqual(results.fallback, { rotation: 0, width: 32, height: 64 });
    console.log('Confirmed catalog metadata gap and installed normalization patch preserves all angle/flip pixels; generated video-element fallback remains upright. AVC/iPhone attribution remains unproven.');
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
