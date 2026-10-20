#!/usr/bin/env node
// Actual carousel + lightbox Live Photos with real MP4 decoding in Chromium:
// still first, hover or press-and-hold plays, release returns to the still. Use
// --build-only when the execution sandbox cannot launch browsers; that only
// validates fixture bundling, NOT browser playback.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { build } = require('esbuild');
const { chromium } = require('playwright');

(async () => {
  const root = path.resolve(__dirname, '..');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-live-carousel-browser-'));
  let browser, server;
  try {
    await build({ stdin: { contents: `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { PostMediaCarousel } from './packages/app/components/feed/post-media-carousel.web';
      import { Lightbox } from './packages/app/components/lightbox.web';
      import { useLightboxStore } from './packages/app/lib/stores/lightbox-store';
      const media = [0,1,2,3].map(i => ({type:'livePhoto',url:'/still.svg',livePhotoVideoUrl:'/clip.mp4?slide='+i}));
      function App() {
        const [id,setId] = React.useState('first');
        window.changePost = () => setId('second');
        window.closeLightbox = () => useLightboxStore.getState().close();
        return <><PostMediaCarousel key={id} media={media} caption="Live Photo regression"/><Lightbox/><div style={{height:2000}}/></>;
      }
      window.root = createRoot(document.getElementById('root')); window.root.render(<App/>);
    `, resolveDir: root, loader: 'tsx' }, bundle: true, outfile: path.join(dir, 'app.js'), platform: 'browser', jsx: 'automatic', alias: { '@dvnt/app': path.join(root, 'packages/app') }, nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean), define: { 'process.env.NODE_ENV': '"test"' } });
    if (process.argv.includes('--build-only')) {
      console.log('PASS actual carousel browser fixture bundles (build-only; playback not executed).'); return;
    }
    execFileSync('ffmpeg', ['-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc=size=160x160:rate=15', '-t', '4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(dir, 'clip.mp4')]);
    server = http.createServer((req, res) => {
      if (req.url === '/app.js') { res.setHeader('Content-Type', 'application/javascript'); res.end(fs.readFileSync(path.join(dir, 'app.js'))); }
      else if (req.url.startsWith('/clip.mp4')) { res.setHeader('Content-Type', 'video/mp4'); res.end(fs.readFileSync(path.join(dir, 'clip.mp4'))); }
      else if (req.url === '/still.svg') { res.setHeader('Content-Type', 'image/svg+xml'); res.end('<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="blue"/></svg>'); }
      else res.end(`<html><head><style>
        body{margin:0;background:black;color:white}#root{width:360px}
        [data-post-media-carousel]{display:flex;overflow-x:auto;scroll-snap-type:x mandatory;width:360px}
        [data-post-media-carousel]>div{flex:none;width:100%;scroll-snap-align:center}
        [data-post-media-carousel] button{display:block;width:100%;border:0;padding:0;background:black}
        [data-post-media-carousel] img{display:block;width:360px;height:360px}[data-live-photo]{position:relative}[data-live-photo-motion]{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}button[aria-label="Live Photo"]{position:absolute;top:0;left:0}
        [role=dialog]{position:fixed;inset:0;z-index:2000;background:black;display:flex;align-items:center;justify-content:center}
        [role=dialog] img{width:320px;height:320px;display:block}[role=dialog] button{position:relative;z-index:1}
      </style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browserChoice = process.env.FEED_BROWSER_CHANNEL ? { channel: process.env.FEED_BROWSER_CHANNEL } : fs.existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {};
    browser = await chromium.launch({ headless: true, ...browserChoice, args: ['--no-sandbox'] });
    const context = await browser.newContext({ viewport: { width: 400, height: 700 }, hasTouch: true });
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(() => document.querySelectorAll('[data-live-photo-motion]').length === 4);
    await page.evaluate(() => document.querySelectorAll('[data-live-photo-motion]').forEach(v => v.addEventListener('playing', () => { v.dataset.everPlayed = '1'; })));
    const clips = '[data-post-media-carousel] [data-live-photo-motion]';
    // index -1: every carousel clip paused. Otherwise only `index` advances on a real clock.
    const active = index => page.waitForFunction(({ index, clips }) => {
      const videos = [...document.querySelectorAll(clips)];
      return videos.length === 4 && videos.every((v, i) => i === index ? !v.paused && v.currentTime > 0.1 : v.paused);
    }, { index, clips });
    const swipe = index => page.evaluate(index => {
      const el = document.querySelector('[data-post-media-carousel]'); el.scrollTo({ left: index * el.clientWidth });
    }, index);
    const slideCenter = async () => {
      const box = await page.locator('[data-post-media-carousel]').boundingBox();
      return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
    };
    const away = () => page.mouse.move(395, 695);
    const touch = async (point, ms) => {
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] });
      await page.waitForTimeout(ms);
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const lightboxOpen = () => page.evaluate(() => !!document.querySelector('[role=dialog]'));
    const everPlayed = () => page.locator(clips).evaluateAll(v => v.map(x => !!x.dataset.everPlayed));

    // Visible and decodable, yet nothing autoplays.
    await page.waitForTimeout(1200);
    assert.deepEqual(await everPlayed(), [false, false, false, false], 'nothing autoplays when visible');
    assert.ok(await page.locator(clips).evaluateAll(videos => videos.every(v => v.muted && v.playsInline && !v.loop && !v.autoplay)));
    assert.equal(await page.locator('button[aria-label="Live Photo"]').count(), 4);

    // Hover plays the selected slide on a real clock; leaving pauses it.
    for (const index of [0, 1, 2, 3, 0]) {
      await away(); await swipe(index); await active(-1);
      const p = await slideCenter(); await page.mouse.move(p.x, p.y); await active(index);
    }
    await away(); await active(-1);
    const pausedTime = await page.locator(clips).nth(0).evaluate(v => v.currentTime);
    await page.waitForTimeout(250);
    assert.equal(await page.locator(clips).nth(0).evaluate(v => v.currentTime), pausedTime, 'a paused clip stays still');
    let p = await slideCenter(); await page.mouse.move(p.x, p.y); await active(0);
    assert.ok(await page.locator(clips).nth(0).evaluate(v => v.currentTime < 1.5), 'a new hover replays from the start');

    // Swiping away from the playing slide pauses it.
    await swipe(1); await active(-1);
    // Rapid hover in/out ends at the still.
    for (let i = 0; i < 5; i++) { await page.mouse.move(p.x, p.y); await page.waitForTimeout(30 + i * 20); await away(); await page.waitForTimeout(20); }
    await page.waitForTimeout(800); await active(-1);

    // Background tab pauses (synthetic Page Visibility; decoding stays real).
    await page.mouse.move(p.x, p.y); await active(1);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }); await active(-1);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    await away(); await active(-1);

    // Touch: a quick tap opens the lightbox without playing.
    await page.evaluate(() => document.querySelectorAll('[data-live-photo-motion]').forEach(v => delete v.dataset.everPlayed));
    p = await slideCenter();
    await touch(p, 100);
    await page.waitForFunction(() => !!document.querySelector('[role=dialog]'));
    assert.deepEqual(await everPlayed(), [false, false, false, false], 'a quick tap does not play');
    const overlay = '[role=dialog] [data-live-photo-motion]';
    assert.equal(await page.locator(overlay).getAttribute('src'), '/clip.mp4?slide=1', 'the lightbox shows the tapped slide\'s clip');
    await page.waitForTimeout(800);
    assert.ok(await page.locator(overlay).evaluate(v => v.paused && v.currentTime === 0), 'the lightbox Live Photo does not autoplay');
    // Holding the lightbox Live Photo plays it; release returns to the still.
    const ob = await page.locator('[role=dialog] [data-live-photo]').boundingBox();
    const op = { x: ob.x + ob.width / 2, y: ob.y + ob.height / 2 };
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [op] });
    await page.waitForFunction(sel => { const v = document.querySelector(sel); return v && !v.paused && v.currentTime > 0.1; }, overlay);
    assert.ok(await page.locator(clips).evaluateAll(v => v.every(x => x.paused)), 'nothing underneath plays');
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await page.waitForFunction(sel => document.querySelector(sel).paused, overlay);
    assert.equal(await lightboxOpen(), true, 'releasing the hold does not close the lightbox');
    await page.evaluate(() => window.closeLightbox());
    await active(-1);

    // Touch: a 250ms tap still opens; a 1.5s hold plays and its release does not open.
    await touch(p, 250);
    await page.waitForFunction(() => !!document.querySelector('[role=dialog]'));
    assert.deepEqual(await everPlayed(), [false, false, false, false], 'a slow tap does not play');
    await page.evaluate(() => window.closeLightbox());
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [p] });
    await active(1);
    await page.waitForTimeout(1000);
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await active(-1);
    await page.waitForTimeout(300);
    assert.equal(await lightboxOpen(), false, 'releasing a hold that played does not open the lightbox');

    // New post resets; unmount leaves nothing playing.
    await page.evaluate(() => window.changePost());
    await page.waitForFunction(() => document.querySelectorAll('[data-live-photo-motion]').length === 4);
    await page.waitForTimeout(600);
    assert.ok(await page.locator(clips).evaluateAll(v => v.every(x => x.paused)));
    p = await slideCenter(); await page.mouse.move(p.x, p.y); await active(0);
    await page.evaluate(() => { window.detached = [...document.querySelectorAll('video')]; window.root.unmount(); });
    assert.ok(await page.evaluate(() => window.detached.every(v => v.paused)));
    assert.deepEqual(errors, []);
    console.log('PASS actual web carousel Live Photos with real MP4 clocks: no autoplay, hover plays the selected slide from 0 and leave pauses, swipe-away pause, rapid hover, background pause, quick and slow taps open without playing, lightbox right clip with no autoplay and hold-to-play, 1.5s hold plays and release does not open, post reset, unmount.');
  } finally {
    await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
