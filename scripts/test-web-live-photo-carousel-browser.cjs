#!/usr/bin/env node
// Actual carousel + lightbox with real MP4 decoding in Chromium. Use
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
        [data-post-motion]{display:block;width:360px;height:360px;pointer-events:none}
        [role=dialog]{position:fixed;inset:0;z-index:2000;background:black;display:flex;align-items:center;justify-content:center}
        [role=dialog] video{width:320px;height:320px}[role=dialog] button{position:relative;z-index:1}
      </style></head><body><div id="root"></div><script src="/app.js"></script></body></html>`);
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browserChoice = process.env.FEED_BROWSER_CHANNEL ? { channel: process.env.FEED_BROWSER_CHANNEL } : fs.existsSync('/usr/bin/chromium') ? { executablePath: '/usr/bin/chromium' } : {};
    browser = await chromium.launch({ headless: true, ...browserChoice, args: ['--no-sandbox'] });
    const page = await browser.newPage({ viewport: { width: 400, height: 700 } });
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const active = index => page.waitForFunction(index => {
      const videos = [...document.querySelectorAll('[data-post-motion]')];
      return videos.length === 4 && videos.every((v, i) => i === index ? !v.paused && v.currentTime > 0.1 : v.paused);
    }, index);
    const swipe = index => page.evaluate(index => {
      const el = document.querySelector('[data-post-media-carousel]'); el.scrollTo({ left: index * el.clientWidth });
    }, index);
    await active(0);
    assert.ok(await page.locator('[data-post-motion]').evaluateAll(videos => videos.every(v => v.muted && v.playsInline && v.loop)));
    for (const index of [1, 2, 3, 0]) { await swipe(index); await active(index); }
    await swipe(1); await active(1);
    await page.locator('[data-post-media-carousel] button[aria-label="Open media"]').nth(1).click();
    await page.waitForFunction(() => {
      const overlay = document.querySelector('[role=dialog] video');
      return overlay && !overlay.paused && overlay.currentTime > 0.1 && [...document.querySelectorAll('[data-post-motion]')].every(v => v.paused);
    });
    await page.evaluate(() => window.closeLightbox()); await active(1);
    await page.evaluate(() => window.scrollTo(0, 1200)); await active(-1);
    const pausedTime = await page.locator('[data-post-motion]').nth(1).evaluate(v => v.currentTime);
    await page.waitForTimeout(250);
    assert.equal(await page.locator('[data-post-motion]').nth(1).evaluate(v => v.currentTime), pausedTime);
    await page.evaluate(() => window.scrollTo(0, 0)); await active(1);
    // Headless tabs do not really background: use the Page Visibility API event
    // with explicit synthetic visibility, while media decoding remains real.
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); }); await active(-1);
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); }); await active(1);
    await page.evaluate(() => window.changePost()); await active(0);
    await page.evaluate(() => { window.detached = [...document.querySelectorAll('video')]; window.root.unmount(); });
    assert.ok(await page.evaluate(() => window.detached.every(v => v.paused)));
    assert.deepEqual(errors, []);
    console.log('PASS actual web carousel + real MP4 clocks: first autoplay, all swipe directions, offscreen/background, lightbox handoff, post reset, unmount, muted inline loop.');
  } finally {
    await browser?.close(); if (server) await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
