// Real Chromium geometry regression. Production hook; local fixture content only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const esbuild = require('esbuild');
const ROOT = path.resolve(__dirname, '..');
(async () => {
  const bundle = await esbuild.build({
    stdin: { contents: `import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
      import {useReviewSection} from './packages/app/features/events/use-review-section.web';
      function Detail(){const ref=useReviewSection(42,true,true);return <section id="reviews" ref={ref} tabIndex={-1}><h2>Ratings & Reviews</h2><p>No reviews yet.</p><button>Write a review</button></section>}
      function Fixture(){const [loaded,setLoaded]=useState(false);const [mounted,setMounted]=useState(true);window.fixture={load:()=>setLoaded(true),unmount:()=>setMounted(false)};return <><header>Fixture fixed public header</header><main><div id="above" style={{height:1400}}>Event details</div>{loaded&&mounted?<Detail/>:null}<div style={{height:1600}}>Remaining event content</div></main></>}
      createRoot(document.getElementById('root')).render(<Fixture/>);`, resolveDir:ROOT,loader:'tsx'},
    bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',
    tsconfigRaw:{compilerOptions:{jsx:'react-jsx',jsxImportSource:'react'}},
    nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),
    define:{'process.env.NODE_ENV':'"test"'},
  });
  const html=`<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    html,body{margin:0;overflow-anchor:none;scroll-behavior:auto}body{font:16px system-ui}header{position:fixed;top:0;left:0;right:0;height:85px;z-index:100;background:black;color:white}
    @media(max-width:600px){header{height:75px}}section{padding:0 20px 20px;scroll-margin-top:110px}h2{margin:0;padding:0;font-size:24px;line-height:32px}button{height:42px}p{line-height:24px}</style><div id="root"></div><script src="/bundle.js"></script>`;
  const server=http.createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/bundle.js'?'text/javascript':'text/html');res.end(req.url==='/bundle.js'?bundle.outputFiles[0].contents:html);});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',resolve);});
  let browser;
  try{
    let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require('@playwright/test'));}
    browser=await chromium.launch({headless:true,...(fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
    for(const viewport of [{width:1280,height:900},{width:390,height:844}]){
      const page=await browser.newPage({viewport,hasTouch:true});const errors=[];page.on('pageerror',error=>errors.push(error.message));
      const open=async()=>{await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForFunction(()=>!!window.fixture);await page.evaluate(()=>window.fixture.load());await page.waitForFunction(()=>window.scrollY>500);};
      const assertVisible=async()=>{await page.waitForFunction(()=>{const header=document.querySelector('header').getBoundingClientRect();const heading=document.querySelector('#reviews h2').getBoundingClientRect();const write=document.querySelector('#reviews button').getBoundingClientRect();return heading.top>=header.bottom&&write.bottom<=innerHeight;});};
      const shrink=async()=>page.evaluate(()=>document.querySelector('#above').style.height='1340px');
      const settle=async()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))));
      await open();await assertVisible();await shrink();await assertVisible();
      await page.evaluate(()=>document.querySelector('#above').style.height='1290px');await assertVisible(); // A later font/content reflow also stays visible.
      assert.equal(await page.evaluate(()=>document.activeElement?.id),'reviews','initial focus stays on the review section');
      for(const input of ['wheel','touch','pointer','key']){
        await open();await assertVisible();
        if(input==='wheel'){await page.mouse.move(viewport.width-20,300);await page.mouse.wheel(0,40);}
        if(input==='touch')await page.touchscreen.tap(viewport.width-20,300);
        if(input==='pointer')await page.mouse.click(viewport.width-20,300);
        if(input==='key')await page.keyboard.press('Escape');
        await settle();
        const before=await page.evaluate(()=>window.scrollY);await shrink();await settle();
        const after=await page.evaluate(()=>window.scrollY);
        assert.ok(Math.abs(after-before)<=1,`${viewport.width}px ${input} cancels late reanchor: ${before} -> ${after}`);
      }
      await open();await page.waitForTimeout(3100);const settled=await page.evaluate(()=>window.scrollY);await shrink();await settle();assert.equal(await page.evaluate(()=>window.scrollY),settled,'settling window expires without user input');
      await open();await page.evaluate(()=>window.fixture.unmount());await settle();const before=await page.evaluate(()=>window.scrollY);await shrink();await settle();assert.equal(await page.evaluate(()=>window.scrollY),before,'unmount cancels observer');
      assert.deepEqual(errors,[]);await page.close();
    }
    console.log('PASS: Chromium desktop/mobile fixed-header visibility, async shrink, wheel/touch/key cancellation, unmount');
  }finally{await browser?.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1;});
