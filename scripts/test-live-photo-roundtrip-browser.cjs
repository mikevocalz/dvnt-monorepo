#!/usr/bin/env node
// Actual unified file selector → original upload bytes → edge/SQL → page reload
// → real video decoding. Identity/admission and media-upload/storage endpoint are
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
      console.log('PASS unified media selector/upload/read/carousel browser fixture bundles (build-only; HTTP, SQL and video playback not executed).'); return;
    }
    const originals = [];
    for (let index = 0; index < 3; index++) {
      // Equal stems are deliberately not proof of an Apple Live Photo pair.
      const still = path.join(directory, `IMG_${index}.jpg`);
      const motion = path.join(directory, `IMG_${index}.mp4`);
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
            [data-browser-media-id] video,[data-browser-media-id] img{width:160px;height:120px;object-fit:contain}input{display:block;margin:8px}
            [data-post-media-carousel]{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;width:360px}
            [data-post-media-carousel]>div{flex:none;width:100%;scroll-snap-align:center}
            [data-post-media-carousel] button{display:block;width:100%;border:0;padding:0;background:black}
            [data-post-motion]{display:block;width:360px;height:360px;pointer-events:none}
            [data-post-media-carousel] img{display:block;width:360px;height:360px}[data-live-photo]{position:relative}
            [data-live-photo-motion]{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}button[aria-label="Live Photo"]{position:absolute;top:0;left:0}
            [role=dialog]{position:fixed;inset:0;z-index:2000;background:black;display:flex;align-items:center;justify-content:center}
            [role=dialog] video,[role=dialog] img{width:320px;height:320px;display:block}[role=dialog] button{position:relative;z-index:1}
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
    const picker = page.getByLabel('Choose photos or videos', { exact: true });
    const settled = count => page.waitForFunction(count => !window.fixture.isPending() && window.fixture.getSelection().selectedMedia.length === count, count);
    const selection = () => page.evaluate(() => window.fixture.getSelection().selectedMedia.map(asset => ({ id: asset.id, kind: asset.kind, name: asset.fileName, uri: asset.uri, pairedVideoUri: asset.pairedVideoUri })));
    const filePayload = (source, name, mimeType) => ({ name, mimeType, buffer: fs.readFileSync(source) });
    const associate = async (imageName, videoName, expectedCount) => {
      const video = (await selection()).find(asset => asset.kind === 'video' && asset.name === videoName);
      assert.ok(video, `Selected motion ${videoName} must remain available`);
      await page.getByLabel(`Motion for ${imageName}`, { exact: true }).selectOption(video.id);
      await settled(expectedCount);
    };
    const resetDraft = async () => {
      await page.evaluate(() => window.fixture.resetDraft());
      await settled(0);
    };
    assert.equal(await page.locator('input[type=file]').count(), 1, 'one picker handles every media type');
    assert.equal(await picker.getAttribute('multiple'), '', 'the unified picker accepts a selection of files');
    assert.equal(await page.getByRole('button', { name: 'Add Photos or Videos', exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Add Live Photo', exact: true }).count(), 0, 'no redundant Live Photo entry point');

    // A JPEG alone and a normal video are ordinary media, never false LIVE.
    await picker.setInputFiles(filePayload(originals[0].still, 'IMG_0.jpg', 'image/jpeg')); await settled(1);
    assert.deepEqual((await selection()).map(asset => asset.kind), ['image']);
    assert.equal(await page.locator('[data-browser-media-kind="livePhoto"]').count(), 0);
    await picker.setInputFiles(filePayload(originals[1].motion, 'ordinary-video.mp4', 'video/mp4')); await settled(2);
    assert.deepEqual((await selection()).map(asset => asset.kind), ['image', 'video']);
    assert.ok((await selection()).every(asset => !asset.pairedVideoUri));
    const ordinaryBeforeRejectedBatch = await selection();
    await picker.setInputFiles([
      filePayload(originals[2].still, 'new-photo.jpg', 'image/jpeg'),
      { name: 'unsupported-motion.webm', mimeType: 'video/webm', buffer: Buffer.from('unsupported motion') },
    ]);
    await page.getByRole('alert').filter({ hasText: 'unsupported-motion.webm' }).waitFor();
    await settled(2);
    assert.deepEqual(await selection(), ordinaryBeforeRejectedBatch, 'reject the whole new batch rather than silently retain only its still');
    await resetDraft();

    // Similar names cannot silently pair the wrong photo. An explicit inline
    // association is reversible and cannot consume the same video twice.
    await picker.setInputFiles([
      filePayload(originals[0].still, 'DUPLICATE.jpg', 'image/jpeg'),
      filePayload(originals[1].still, 'DUPLICATE.jpeg', 'image/jpeg'),
      filePayload(originals[0].motion, 'DUPLICATE.mp4', 'video/mp4'),
    ]);
    await settled(3);
    assert.deepEqual((await selection()).map(asset => asset.kind), ['image', 'image', 'video']);
    const ambiguousBefore = await selection();
    await associate('DUPLICATE.jpeg', 'DUPLICATE.mp4', 2);
    let ambiguous = await selection();
    assert.equal(ambiguous[0].kind, 'image'); assert.equal(ambiguous[1].kind, 'livePhoto');
    assert.equal(ambiguous[1].id, ambiguousBefore[1].id, 'association preserves the chosen still identity');
    assert.equal(ambiguous[1].uri, ambiguousBefore[1].uri);
    assert.equal(ambiguous[1].pairedVideoUri, ambiguousBefore[2].uri);
    assert.equal(await page.getByLabel('Motion for DUPLICATE.jpg', { exact: true }).locator(`option[value="${ambiguousBefore[2].id}"]`).count(), 0, 'one motion cannot be attached twice');
    await page.getByLabel('Motion for DUPLICATE.jpeg', { exact: true }).selectOption(''); await settled(3);
    ambiguous = await selection();
    assert.equal(ambiguous.filter(asset => asset.kind === 'livePhoto').length, 0);
    assert.ok(ambiguous.some(asset => asset.kind === 'video' && asset.uri === ambiguousBefore[2].uri), 'disassociation restores the original video without re-encoding');
    assert.ok(ambiguous.some(asset => asset.id === ambiguousBefore[1].id && asset.kind === 'image'));
    assert.deepEqual(await harness.counts(), { posts: 0, media: 0, requests: 0 });
    await resetDraft();

    // Corrupt motion rejects the entire new selection. Never silently keep
    // its still and unlock publishing as if a Live Photo had been imported.
    await picker.setInputFiles([
      filePayload(originals[0].still, 'IMG_0.jpg', 'image/jpeg'),
      { name: 'broken.mp4', mimeType: 'video/mp4', buffer: Buffer.from('not decodable motion') },
    ]);
    await page.getByRole('alert').filter({ hasText: 'broken.mp4' }).waitFor();
    await settled(0);
    assert.deepEqual(await selection(), [], 'undecodable motion rejects its accompanying still too');
    assert.equal(await page.locator('[data-publish]').isDisabled(), true);
    assert.deepEqual(await harness.counts(), { posts: 0, media: 0, requests: 0 });
    await resetDraft();

    // Select a whole mixed array once, then attach motion inline. File names
    // alone never create LIVE badges, including three unique equal stems.
    await picker.setInputFiles([
      ...originals.flatMap(pair => [
        filePayload(pair.still, path.basename(pair.still), 'image/jpeg'),
        filePayload(pair.motion, path.basename(pair.motion), 'video/mp4'),
      ]),
      filePayload(originals[0].still, 'ordinary-still.jpg', 'image/jpeg'),
      filePayload(originals[2].motion, 'ordinary-video.mp4', 'video/mp4'),
    ]);
    await settled(8);
    assert.ok((await selection()).every(asset => asset.kind !== 'livePhoto'));
    for (let index = 0; index < originals.length; index++) await associate(`IMG_${index}.jpg`, `IMG_${index}.mp4`, 7 - index);
    assert.deepEqual((await selection()).map(asset => asset.kind), ['livePhoto', 'livePhoto', 'livePhoto', 'image', 'video']);
    harness.state.failMotion = true;
    await page.locator('[data-publish]').click();
    await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.includes('motion upload failure'));
    assert.deepEqual(await harness.counts(), { posts: 0, media: 0, requests: 0 });
    assert.equal(harness.state.creates.length, 0);
    const failedUploads = await page.evaluate(() => window.fixture.client.state.descriptor.uploaded);
    assert.deepEqual(failedUploads.map(upload => upload !== null), [false, false, false, true, false], 'only the independent still may be cached after failed motion uploads');
    harness.state.failMotion = false;
    await page.locator('[data-publish]').click();
    await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent === 'Saved post loaded');
    assert.deepEqual(await harness.counts(), { posts: 1, media: 5, requests: 1 });
    const rows = (await harness.db.query('SELECT * FROM posts_media ORDER BY _order')).rows;
    for (let index = 0; index < originals.length; index++) {
      assert.equal(rows[index]._order, index);
      assert.equal(harness.state.objects.get(new URL(rows[index].url).pathname).sha256, digest(fs.readFileSync(originals[index].still)));
      assert.equal(harness.state.objects.get(new URL(rows[index].live_photo_video_url).pathname).sha256, digest(fs.readFileSync(originals[index].motion)));
    }
    assert.equal(rows[3].type, 'image'); assert.equal(rows[3].live_photo_video_url, null);
    assert.equal(rows[4].type, 'video'); assert.equal(rows[4].live_photo_video_url, null);
    assert.equal(harness.state.objects.get(new URL(rows[3].url).pathname).sha256, digest(fs.readFileSync(originals[0].still)));
    assert.equal(harness.state.objects.get(new URL(rows[4].url).pathname).sha256, digest(fs.readFileSync(originals[2].motion)));
    // Live Photo slides (0-2) autoplay their decoded pair when selected and in
    // view; the still image (slide 3) leaves everything paused; the ordinary
    // video (slide 4) autoplays when selected.
    const active = index => page.waitForFunction(index => {
      const clips = [...document.querySelectorAll('[data-post-media-carousel] [data-live-photo-motion]')];
      const autoplay = [...document.querySelectorAll('[data-post-motion]')];
      const running = video => !video.paused && video.currentTime > 0.1 && video.videoWidth > 0;
      return clips.length === 3 && autoplay.length === 1 &&
        clips.every((video, i) => i === index ? running(video) : video.paused) &&
        (index === 4 ? running(autoplay[0]) : autoplay[0].paused);
    }, index);
    const away = () => page.mouse.move(415, 895);
    await away(); await active(0);
    assert.equal(await page.locator('[data-post-media-carousel] button[aria-label="Live Photo"]').count(), 3, 'each saved pair shows a LIVE badge');
    await page.reload(); // No in-memory upload, object URL, or optimistic cache survives.
    await page.waitForFunction(() => document.querySelectorAll('[data-post-media-carousel] [data-live-photo-motion]').length === 3);
    await away(); await active(0);
    assert.ok(harness.state.reads.length >= 2, 'fresh page must fetch persisted rows again');
    assert.deepEqual(await page.evaluate(() => window.fixture.getPost().media.map(m => ({ type: m.type, url: m.url, video: m.livePhotoVideoUrl ?? null }))), rows.map((row, index) => ({ type: index < 3 ? 'livePhoto' : row.type, url: row.url, video: row.live_photo_video_url })));
    assert.deepEqual(await page.locator('[data-post-media-carousel] [data-live-photo-motion]').evaluateAll(v => v.map(x => x.getAttribute('src'))), rows.slice(0, 3).map(row => row.live_photo_video_url));
    for (const index of [1, 2, 3, 4, 0]) {
      await page.evaluate(index => { const carousel = document.querySelector('[data-post-media-carousel]'); carousel.scrollTo({ left: index * carousel.clientWidth }); }, index);
      await active(index === 3 ? -1 : index);
    }
    assert.ok(await page.locator('[data-post-media-carousel] [data-live-photo-motion]').evaluateAll(videos => videos.every(v => v.muted && !v.loop && v.playsInline)));
    assert.ok(await page.locator('[data-post-motion]').evaluateAll(videos => videos.every(v => v.muted && v.loop && v.playsInline)));
    await page.evaluate(() => document.querySelector('[aria-label="Open media"]').click());
    const overlay = '[role=dialog] [data-live-photo-motion]';
    await page.waitForSelector(overlay, { state: 'attached' });
    assert.equal(await page.locator(overlay).getAttribute('src'), rows[0].live_photo_video_url);
    await page.waitForFunction(sel => { const v = document.querySelector(sel); return !v.paused && v.currentTime > 0.1 && v.videoWidth > 0; }, overlay);
    assert.ok(await page.locator('[data-post-media-carousel] video').evaluateAll(v => v.every(x => x.paused)), 'nothing underneath plays while the lightbox Live Photo autoplays');
    await page.evaluate(() => window.fixture.closeLightbox()); await active(0);
    assert.deepEqual(errors, []); assert.deepEqual(routeErrors, []);
    console.log('PASS one actual media picker: ordinary files never falsely LIVE, explicit ambiguous association/disassociation, decoded pairs, mixed original multipart upload, edge+PostgreSQL persistence, reload, Live Photo carousel/lightbox (selected decoded pair autoplays, still image pauses all, ordinary video autoplays) and retry without a partial post.');
  } finally {
    await browser?.close();
    if (server?.listening) await new Promise(resolve => server.close(resolve));
    await harness?.close(); fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
