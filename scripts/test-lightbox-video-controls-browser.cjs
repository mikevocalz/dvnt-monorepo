#!/usr/bin/env node
// Real post-detail media carousel -> fullscreen lightbox, generated production
// CSS and decoded local video. No account/network/backend writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { postMediaAuthFixture } = require('./fixtures/post-media-auth.cjs');
const ROOT = path.resolve(__dirname, '..');
const paths = [...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean), ROOT];
const resolve = name => require.resolve(name, { paths });
const load = name => require(resolve(name));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lightbox-controls-'));
  let browser;
  try {
    const videoUrl = 'data:video/webm;base64,' + fs.readFileSync(path.join(__dirname, 'fixtures/lightbox-controls-video.webm')).toString('base64');
    await load('esbuild').build({ stdin: { contents: `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { PostMediaCarousel } from './packages/app/components/feed/post-media-carousel.web';
      import { Lightbox } from './packages/app/components/lightbox.web';
      const media = [{type:'video',url:${JSON.stringify(videoUrl)}}];
      createRoot(document.getElementById('root')).render(<><PostMediaCarousel media={media} caption="Offline video"/><Lightbox/></>);
    `, loader:'tsx', resolveDir:ROOT }, bundle:true, plugins:[postMediaAuthFixture(ROOT)], platform:'browser', jsx:'automatic', outfile:path.join(dir,'app.js'), alias:{'@dvnt/app':path.join(ROOT,'packages/app')}, nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean), define:{'process.env.NODE_ENV':'"test"'} });
    const tw = path.dirname(resolve('tailwindcss/package.json'));
    const sources = ['packages/app/components/lightbox.web.tsx','packages/app/components/feed/post-media-carousel.web.tsx'];
    const css = (await load('postcss')([load('@tailwindcss/postcss')({base:ROOT})]).process(
      `@import "${tw}/theme.css" layer(theme);\n@import "${tw}/preflight.css" layer(base);\n@import "${tw}/utilities.css" important;\n` + sources.map(s=>`@source "${path.join(ROOT,s)}";`).join('\n'), {from:path.join(ROOT,'lightbox-fixture.css')}
    )).css;
    if (process.argv.includes('--build-only')) { console.log('PASS actual lightbox controls browser fixture and CSS bundle (playback not executed).'); return; }
    const browserChoice = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? {executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH} : process.env.FEED_BROWSER_CHANNEL ? {channel:process.env.FEED_BROWSER_CHANNEL} : {};
    browser = await load('playwright').chromium.launch({headless:true, ...browserChoice, args:['--no-sandbox']});
    const page = await browser.newPage({viewport:{width:320,height:568},hasTouch:true});
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    await page.route('https://**',route=>route.abort());
    await page.setContent('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:black"><div id="root"></div></body></html>');
    await page.addStyleTag({content:css}); await page.addScriptTag({path:path.join(dir,'app.js')});
    for(const viewport of [{width:320,height:568},{width:375,height:812},{width:812,height:375}]) {
      await page.setViewportSize(viewport);
      for(let cycle=0;cycle<2;cycle++) {
        await page.getByRole('button',{name:'Open media'}).click();
        const dialog=page.getByRole('dialog'); const video=dialog.locator('video');
        await video.waitFor(); await video.evaluate(v=>v.readyState>=2?null:new Promise(resolve=>v.addEventListener('loadeddata',resolve,{once:true})));
        const close=dialog.getByRole('button',{name:'Close',exact:true});
        const cb=await close.boundingBox(), vb=await video.boundingBox();
        assert.ok(vb.y>=cb.y+cb.height+8, 'native video controls must be below the close toolbar: '+JSON.stringify({viewport,cb,vb}));
        assert.ok(vb.y+vb.height<=viewport.height, 'native bottom controls remain in viewport');
        assert.equal(await video.evaluate(v=>v.controls),true,'native play, seek and fullscreen controls preserved');
        const sound=dialog.getByRole('button',{name:/^(Unmute|Mute) video$/});
        for(const button of [close,sound]) {
          const box=await button.boundingBox(); assert.ok(box.width>=44&&box.height>=44,'44px touch targets');
          assert.equal(await button.evaluate(el=>{const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),true,'control receives pointer hits');
        }
        const before=await video.evaluate(v=>v.muted); await sound.click();
        assert.equal(await video.evaluate(v=>v.muted),!before,'sound toggle changes real video');
        await sound.click(); assert.equal(await video.evaluate(v=>v.muted),before);
        await video.evaluate(v=>v.play()); await page.waitForFunction(()=>!document.querySelector('[role=dialog] video').paused);
        await video.evaluate(v=>v.pause()); assert.equal(await video.evaluate(v=>v.paused),true);
        await video.evaluate(v=>v.requestFullscreen());
        assert.equal(await video.evaluate(v=>document.fullscreenElement===v),true,'native fullscreen still opens');
        await page.evaluate(()=>document.exitFullscreen());
        await page.waitForFunction(()=>!document.fullscreenElement);
        if(process.env.LIGHTBOX_SCREENSHOT_DIR) {fs.mkdirSync(process.env.LIGHTBOX_SCREENSHOT_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.LIGHTBOX_SCREENSHOT_DIR,`controls-${viewport.width}x${viewport.height}-${cycle}.png`)});}
        if(cycle===0) await close.click(); else await page.keyboard.press('Escape');
        await dialog.waitFor({state:'detached'});
        assert.equal(await page.evaluate(()=>document.body.style.overflow),'','close restores scroll');
      }
    }
    assert.deepEqual(errors,[]);
    console.log('PASS post-detail maximize video: real carousel/lightbox, decoded portrait video, 320/375/812 layouts, reserved native controls, 44px pointer hits, sound/play/pause, repeated close/reopen and Escape');
  } finally { if(browser) await browser.close(); fs.rmSync(dir,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
