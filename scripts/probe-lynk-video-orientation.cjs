/** Diagnostic only. Generated pixels, no cameras, permissions, relay or tokens. */
const assert = require('node:assert/strict');
const http = require('node:http');
const { chromium } = require('playwright');
const { buildSync } = require('esbuild');
const sdk = buildSync({ stdin: { contents: 'import * as Publish from "@moq/publish"; window.Publish = Publish;', resolveDir: process.env.LYNK_PROBE_DEPS || process.cwd() }, bundle: true, write: false, format: 'iife', platform: 'browser' }).outputFiles[0].text;
(async () => {
  const server = http.createServer((_q, r) => r.end('<html></html>')).listen(0, '127.0.0.1');
  await new Promise(resolve => server.on('listening', resolve));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.addScriptTag({ content: sdk });
    const results = await page.evaluate(async () => {
      const { Video, Signals } = window.Publish;
      const canvas = new OffscreenCanvas(64, 32);
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'red'; ctx.fillRect(0, 0, 32, 32);
      ctx.fillStyle = 'blue'; ctx.fillRect(32, 0, 32, 32);
      const rows = [];
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
            return rgba[0] > rgba[2] ? 'R' : 'B';
          }).join('');
          const result = { rotation: frame.rotation ?? 0, width: frame.displayWidth, height: frame.displayHeight, corners };
          frame.close(); decoder.close(); return result;
        };
        return { metadata: metadata.decoderConfig, preserved: await decode(metadata.decoderConfig), catalog: await decode(catalog) };
      };
      for (const rotation of [0, 90, 180, 270]) {
        const frame = new VideoFrame(canvas, { timestamp: 0, rotation });
        if (frame.rotation !== rotation) throw new Error('Browser does not implement VideoFrame rotation');
        // Resolve exactly the locked SDK's encoder/catalog configuration; no transport.
        const sdkEncoder = new Video.Encoder(new Signals.Signal(frame), new Signals.Signal({ getSettings: () => ({ frameRate: 30 }) }), new Signals.Signal(undefined), { enabled: true, config: { codec: 'avc1' } });
        for (let n = 0; !sdkEncoder.resolved.peek() && n < 100; n++) await new Promise(r => setTimeout(r, 20));
        const config = sdkEncoder.resolved.peek(); const catalog = sdkEncoder.catalog.peek();
        if (!config || !catalog) throw new Error('SDK failed to resolve AVC config');
        const wire = await encode(frame, config, catalog);
        // Control: rasterizing the display orientation before encoding should work
        // even when orientation metadata is omitted. This is NOT an app change.
        const upright = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
        upright.getContext('2d').drawImage(frame, 0, 0);
        const normalized = new VideoFrame(upright, { timestamp: 0 });
        const normalizedWire = await encode(normalized, { ...config, width: normalized.codedWidth, height: normalized.codedHeight }, { ...catalog, codedWidth: normalized.codedWidth, codedHeight: normalized.codedHeight });
        rows.push({ rotation, input: { width: frame.displayWidth, height: frame.displayHeight }, sdkCatalog: catalog, wire, normalized: normalizedWire.catalog });
        normalized.close(); frame.close(); sdkEncoder.close();
      }
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
      return { userAgent: navigator.userAgent, rows, fallback: fallbackResult };
    });
    console.log(JSON.stringify(results, null, 2));
    for (const row of results.rows) {
      const expectedCorners = { 0: 'RBRB', 90: 'RRBB', 180: 'BRBR', 270: 'BBRR' }[row.rotation];
      assert.equal(row.wire.preserved.rotation, row.rotation);
      assert.equal(row.wire.preserved.corners, expectedCorners);
      assert.equal(row.wire.catalog.corners, 'RBRB', 'Raw encoded pixels retain sensor orientation');
      assert.equal(row.normalized.corners, expectedCorners, 'Rasterized control must preserve displayed pixels');
      assert.equal(row.wire.catalog.rotation, 0, 'Reproduce catalog losing raw-frame rotation');
      assert.equal(row.normalized.rotation, 0);
      assert.equal(row.normalized.width, row.input.width);
      assert.equal(row.normalized.height, row.input.height);
    }
    assert.deepEqual(results.fallback, { rotation: 0, width: 32, height: 64 });
    console.log('Confirmed raw-frame metadata gap; video-element fallback control remains upright. This does not identify the reported device path.');
  } finally { await browser?.close(); server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
