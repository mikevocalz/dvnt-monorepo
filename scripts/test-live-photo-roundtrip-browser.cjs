#!/usr/bin/env node
// Actual file selector → original upload bytes → edge/SQL → page reload → real
// video decoding. Identity/admission and media-upload/storage endpoint are
// test adapters; create-post handler and checked-in PostgreSQL SQL are real.
// --build-only validates bundling, NOT browser execution or playback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { build } = require('esbuild');
const { chromium } = require('playwright');
const { createHarness, clientAdapters, root, digest } = require('./fixtures/live-photo-roundtrip/harness.cjs');

(async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'live-photo-roundtrip-browser-'));
  let harness, browser, server;
  try {
    await build({ entryPoints: [path.join(__dirname, 'fixtures/live-photo-roundtrip/browser.tsx')], bundle: true, outfile: path.join(directory, 'app.js'), platform: 'browser', jsx: 'automatic', plugins: [clientAdapters()], alias: { '@dvnt/app': path.join(root, 'packages/app') }, nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean), define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' } });
    if (process.argv.includes('--build-only')) {
      console.log('PASS real Live Photo selector/upload/read/carousel browser fixture bundles (build-only; HTTP, SQL and video playback not executed).'); return;
    }
    const originals = [];
    for (let index = 0; index < 3; index++) {
      const still = path.join(directory, `still-${index}.jpg`);
      const motion = path.join(directory, `motion-${index}.mp4`);
      execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', `color=c=${['red', 'green', 'blue'][index]}:size=96x96`, '-frames:v', '1', '-threads', '1', still]);
      execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=96x96:rate=12', '-vf', `hue=h=${index * 90}`, '-t', '3', '-c:v', 'libx264', '-threads', '1', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-metadata', `comment=synthetic-pair-${index}`, motion]);
      originals.push({ still, motion });
    }
    harness = await createHarness();
    const routeErrors = [];
    server = http.createServer(async (req, res) => {
      try {
        if (req.url === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(fs.readFileSync(path.join(directory, 'app.js'))); return; }
        if (req.url === '/favicon.ico') { res.statusCode = 204; res.end(); return; }
        if (req.url === '/') {
          res.setHeader('Content-Type', 'text/html');
          res.end(`<html><head><style>
            body{margin:0;background:#111;color:white;font:14px sans-serif}#root{width:360px}button{min-height:40px}
            [aria-label="Live Photo motion preview"]{width:240px;height:160px}input{display:block;margin:8px}
            [data-post-media-carousel]{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;width:360px}
            [data-post-media-carousel]>div{flex:none;width:100%;scroll-snap-align:center}
            [data-post-media-carousel] button{display:block;width:100%;border:0;padding:0;background:black}
            [data-post-motion]{display:block;width:360px;height:360px;pointer-events:none}
            [role=dialog]{position:fixed;inset:0;z-index:2000;background:black;display:flex;align-items:center;justify-content:center}
            [role=dialog] video{width:320px;height:320px}[role=dialog] button{position:relative;z-index:1}
          </style></head><body><div id="root"></div><script>globalThis.fixtureOrigin=location.origin;</script><script src="/app.js"></script></body></html>`); return;
        }
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const request = new Request(`http://127.0.0.1:${server.address().port}${req.url}`, { method: req.method, headers: req.headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : { body: Buffer.concat(chunks) }) });
        const response = await harness.handle(request);
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer()));
      } catch (error) { routeErrors.push(error.message); res.statusCode = 500; res.end('Fixture transport failed'); }
    });
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
    const choice = process.env.FEED_BROWSER_CHANNEL ? { channel: process.env.FEED_BROWSER_CHANNEL } : fs.existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {};
    browser = await chromium.launch({ headless: true, ...choice, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 420, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    const origin = `http://127.0.0.1:${server.address().port}`;
    // No external service can receive test uploads even if a production import
    // unexpectedly tries to use a configured endpoint.
    await page.route('**/*', route => {
      const url = route.request().url();
      return url.startsWith(origin + '/') || url.startsWith('blob:') || url.startsWith('data:') ? route.continue() : route.abort('blockedbyclient');
    });
    await page.goto(origin);
    const open = () => page.getByRole('button', { name: 'Add Live Photo', exact: true }).click();
    const add = () => page.getByRole('button', { name: 'Add pair to post', exact: true });
    await open();
    await page.getByLabel('1. Still photo').setInputFiles(originals[0].still);
    assert.equal(await add().isDisabled(), true, 'still-only input cannot claim a Live Photo');
    assert.deepEqual(await harness.counts(), { posts: 0, media: 0, requests: 0 });
    await page.getByLabel('2. Matching motion file').setInputFiles({ name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not decodable motion') });
    await page.getByRole('alert').filter({ hasText: 'could not play' }).waitFor();
    assert.equal(await add().isDisabled(), true, 'invalid codec/container never commits a flattened still');
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    for (let index = 0; index < originals.length; index++) {
      await open();
      await page.getByLabel('1. Still photo').setInputFiles(originals[index].still);
      await page.getByLabel('2. Matching motion file').setInputFiles(originals[index].motion);
      await page.waitForFunction(() => { const v = document.querySelector('[aria-label="Live Photo motion preview"]'); return v && v.readyState >= 2 && v.duration > 0; });
      await add().click();
      await page.waitForFunction(count => document.querySelector('[data-selected]')?.textContent === String(count), index + 1);
    }
    harness.state.failMotion = true;
    await page.locator('[data-publish]').click();
    await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('motion upload failure'));
    assert.deepEqual(await harness.counts(), { posts: 0, media: 0, requests: 0 });
    assert.equal(harness.state.creates.length, 0);
    assert.deepEqual(await page.evaluate(() => window.fixture.client.state.descriptor.uploaded), [null, null, null]);
    harness.state.failMotion = false;
    await page.locator('[data-publish]').click();
    await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent === 'Saved post loaded');
    assert.deepEqual(await harness.counts(), { posts: 1, media: 3, requests: 1 });
    const rows = (await harness.db.query('SELECT * FROM posts_media ORDER BY _order')).rows;
    for (let index = 0; index < rows.length; index++) {
      assert.equal(rows[index]._order, index);
      assert.equal(harness.state.objects.get(new URL(rows[index].url).pathname).sha256, digest(fs.readFileSync(originals[index].still)));
      assert.equal(harness.state.objects.get(new URL(rows[index].live_photo_video_url).pathname).sha256, digest(fs.readFileSync(originals[index].motion)));
    }
    const active = index => page.waitForFunction(index => {
      const videos = [...document.querySelectorAll('[data-post-motion]')];
      return videos.length === 3 && videos.every((video, i) => i === index ? !video.paused && video.currentTime > 0.1 && video.videoWidth > 0 : video.paused);
    }, index);
    await active(0);
    await page.reload(); // No in-memory upload, object URL, or optimistic cache survives.
    await active(0);
    assert.ok(harness.state.reads.length >= 2, 'fresh page must fetch persisted rows again');
    assert.deepEqual(await page.evaluate(() => window.fixture.getPost().media.map(m => ({ type: m.type, url: m.url, video: m.livePhotoVideoUrl }))), rows.map(row => ({ type: 'livePhoto', url: row.url, video: row.live_photo_video_url })));
    for (const index of [1, 2, 0]) {
      await page.evaluate(index => { const carousel = document.querySelector('[data-post-media-carousel]'); carousel.scrollTo({ left: index * carousel.clientWidth }); }, index);
      await active(index);
    }
    assert.ok(await page.locator('[data-post-motion]').evaluateAll(videos => videos.every(v => v.muted && v.loop && v.playsInline)));
    await page.locator('[aria-label="Open media"]').first().click();
    await page.waitForFunction(() => { const video = document.querySelector('[role=dialog] video'); return video && !video.paused && video.currentTime > 0.1 && [...document.querySelectorAll('[data-post-motion]')].every(v => v.paused); });
    await page.evaluate(() => window.fixture.closeLightbox()); await active(0);
    assert.deepEqual(errors, []); assert.deepEqual(routeErrors, []);
    console.log('PASS actual Live Photo picker, decoded originals, multipart upload, edge+PostgreSQL persistence, browser reload, ordered carousel playback and lightbox; missing/unplayable motion refused and failed pair upload retries without a partial post.');
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await harness?.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
