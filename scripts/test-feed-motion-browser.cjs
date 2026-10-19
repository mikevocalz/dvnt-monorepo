#!/usr/bin/env node
// Real Chromium media decoding and production hook; no mocked play()/clock.
// Requires ffmpeg and Playwright Chromium, plus installed workspace deps.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { build } = require('esbuild');
const { chromium } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feed-motion-'));
  let browser, server;
  try {
    execFileSync('ffmpeg', ['-loglevel','error','-f','lavfi','-i','testsrc=size=120x120:rate=15','-f','lavfi','-i','sine=frequency=440:sample_rate=44100','-t','4','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-movflags','+faststart',path.join(dir,'clip.mp4')]);
    await build({ stdin: { contents: `
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import { useFeedVideo } from './packages/app/components/feed/use-feed-video.web';
      import { useStoryViewerStore } from './packages/app/lib/stores/story-viewer-store';
      function Tile({ id, src='/clip.mp4' }) { const p = useFeedVideo(src); return <div><video id={id} ref={p.ref} src={src} muted={p.muted} loop playsInline width="120" height="120"/><button id={id+'-sound'} onClick={p.toggleSound}>Sound</button>{p.blocked && <button onClick={p.play}>Play</button>}</div>; }
      function App() { const [src,setSrc]=React.useState("/clip.mp4"); window.replaceSource=()=>setSrc("/clip.mp4?replacement=1"); return <><Tile id="first" src={src}/><Tile id="second"/><button id="story" onClick={()=>useStoryViewerStore.setState({open:true})}>Story</button><button id="close" onClick={()=>useStoryViewerStore.setState({open:false})}>Close</button><div style={{height:2000}}/></>; }
      window.root = createRoot(document.getElementById('root')); window.root.render(<App/>);
    `, resolveDir: root, loader: 'tsx' }, bundle:true, outfile:path.join(dir,'app.js'), platform:'browser', jsx:'automatic', nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean), alias: { '@dvnt/app':path.join(root,'packages/app') }, define: { 'process.env.NODE_ENV':'"test"' } });
    server = http.createServer((req,res)=>{
      if(req.url==='/app.js') {res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync(path.join(dir,'app.js')));}
      else if(req.url.startsWith('/clip.mp4')) {res.setHeader('Content-Type','video/mp4');res.end(fs.readFileSync(path.join(dir,'clip.mp4')));}
      else res.end('<html><body><div id="root"></div><script src="/app.js"></script></body></html>');
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    browser=await chromium.launch({headless:true, ...(fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{}), args:['--no-sandbox','--autoplay-policy=user-gesture-required']});
    const page=await browser.newPage({viewport:{width:400,height:700}});
    const errors=[]; page.on('pageerror', e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    try {
      await page.waitForFunction(()=>document.querySelector('#first')?.currentTime>0.2 && document.querySelector('#second')?.currentTime>0.2);
    } catch (error) {
      console.error('Initial playback diagnostics', await page.evaluate(()=>({hidden:document.hidden,text:document.body.innerText,videos:[...document.querySelectorAll('video')].map(v=>({src:v.currentSrc,time:v.currentTime,paused:v.paused,muted:v.muted,ready:v.readyState,network:v.networkState,error:v.error?.message,rect:v.getBoundingClientRect().toJSON()}))})), errors);
      throw error;
    }
    assert.ok(await page.locator('#first').evaluate(v=>!v.paused && v.muted));
    await page.click('#first-sound'); assert.equal(await page.locator('#first').evaluate(v=>v.muted),false);
    await page.click('#second-sound'); assert.equal(await page.locator('#first').evaluate(v=>v.muted),true); assert.equal(await page.locator('#second').evaluate(v=>v.muted),false);
    await page.evaluate(()=>window.replaceSource());
    await page.waitForFunction(()=>document.querySelector('#first').src.includes('replacement') && document.querySelector('#first').currentTime>0.2);
    assert.equal(await page.locator('#first').evaluate(v=>v.muted),true);
    await page.click('#story'); await page.waitForFunction(()=>[...document.querySelectorAll('video')].every(v=>v.paused));
    await page.click('#close'); await page.waitForFunction(()=>[...document.querySelectorAll('video')].every(v=>!v.paused));
    await page.evaluate(()=>window.scrollTo(0,1200)); await page.waitForFunction(()=>[...document.querySelectorAll('video')].every(v=>v.paused));
    const pausedTime=await page.locator('#first').evaluate(v=>v.currentTime);
    await page.waitForTimeout(250); assert.equal(await page.locator('#first').evaluate(v=>v.currentTime),pausedTime);
    await page.evaluate(()=>window.scrollTo(0,0)); await page.waitForFunction(()=>!document.querySelector('#first').paused);
    // The Page Visibility API event drives the same production lifecycle;
    // synthetic state is used because headless Chromium does not background tabs.
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(()=>[...document.querySelectorAll('video')].every(v=>v.paused));
    await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});
    await page.waitForFunction(()=>!document.querySelector('#first').paused);
    await page.evaluate(()=>{window.detachedVideo=document.querySelector('#first');window.root.unmount();});
    assert.equal(await page.evaluate(()=>window.detachedVideo.paused),true);
    assert.deepEqual(errors,[]);
    // Ensure the actual feed route invokes the tested hook for ordinary videos.
    const home=fs.readFileSync(path.join(root,'packages/app/features/home/screen.web.tsx'),'utf8');
    assert.match(home, /: isVideo\s*\? media.url/); assert.match(home,/ref=\{playback.ref\}/);
    console.log('PASS: real video time advances; scrolling, stories, background and unmount pause; user sound is exclusive.');
  } finally {await browser?.close();if(server)await new Promise(r=>server.close(r));fs.rmSync(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1;});
