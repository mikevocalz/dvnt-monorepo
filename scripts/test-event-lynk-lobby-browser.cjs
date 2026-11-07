#!/usr/bin/env node
/** Actual web waiting-branch + RoomShell source extraction, real waiting hook and
 * generated Tailwind. Transport/session/navigation boundaries are synthetic.
 * NOT full-room integration or live admission/media acceptance.
 * LYNK_BROWSER=chromium|webkit; --screenshots writes /tmp/event-lynk-lobby-*.png.
 */
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const ROOT=path.resolve(__dirname,'..');
const paths=[...(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),ROOT];
const resolve=n=>require.resolve(n,{paths}),load=n=>require(resolve(n));
(async()=>{
 const source=fs.readFileSync(path.join(ROOT,'packages/app/features/sneaky-lynk/screens/room.web.tsx'),'utf8');
 const branch=source.slice(source.indexOf('  if (phase === "waiting") {'),source.indexOf('  if (phase === "app-only") {'));
 const shell=source.slice(source.indexOf('function RoomShell({'),source.indexOf('// ── Public entry:'));
 const boundaries=new Map([
  ['@dvnt/app/lib/api/event-lynk',`export const eventLynkApi={wait:()=>new Promise((resolve,reject)=>window.fixture.pending.push({resolve,reject}))};`],
  ['@dvnt/app/lib/auth/session-lifecycle',`export const getSessionLifecycle=()=>({epoch:1});`],
 ]);
 const bundle=await load('esbuild').build({stdin:{resolveDir:ROOT,loader:'tsx',contents:`
 import React from 'react';import{createRoot}from'react-dom/client';import{Radio,ArrowLeft}from'lucide-react';
 import{eventWaitingCopy}from'./packages/app/features/sneaky-lynk/ui/event-waiting-copy';
 import{useEventLynkWaitingRoom}from'./packages/app/features/sneaky-lynk/hooks/useEventLynkWaitingRoom';
 const f=window.fixture={pending:[],actions:[],admissions:0};
 const router={push:route=>{f.actions.push('navigate:'+route);f.cancelStatus=f.controls.status;}};
 const LYNKS_LIST_ROUTE='/feed/messages';
 ${shell}
 function App(){const phase='waiting';const controls=useEventLynkWaitingRoom({roomId:'test-event',enabled:true,onAdmitted:()=>f.admissions++});
 f.controls=controls;const eventWaiting={...controls,cancel:()=>{f.actions.push('cancel');controls.cancel();}};
 ${branch}}
 createRoot(document.getElementById('root')).render(<App/>);`},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',nodePaths:paths,alias:Object.fromEntries(['react','react-dom'].map(n=>[n,path.dirname(resolve(n+'/package.json'))])),plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>{if(boundaries.has(a.path))return{path:a.path,namespace:'fixture'};if(a.path.startsWith('@dvnt/app/'))return b.resolve(path.join(ROOT,'packages/app',a.path.slice(10)),{resolveDir:ROOT,kind:a.kind});});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:boundaries.get(a.path),loader:'tsx'}));}}]});
 const tw=path.dirname(resolve('tailwindcss/package.json'));
 const css=await load('postcss')([load('@tailwindcss/postcss')({base:ROOT})]).process(`@import "${tw}/theme.css" layer(theme);@import "${tw}/preflight.css" layer(base);@import "${tw}/utilities.css" important;@source "${path.join(ROOT,'packages/app/features/sneaky-lynk')}";`,{from:path.join(ROOT,'lobby-fixture.css')});
 assert.match(css.css,/\.flex\s*\{/);
 const name=process.env.LYNK_BROWSER||'chromium';const browser=await load('playwright')[name].launch({headless:true});
 let cases=0;
 try{for(const width of [320,390,1280])for(const scale of [1,1.5])for(const status of ['checking','reconnecting','ready']){
  const page=await browser.newPage({viewport:{width,height:650},reducedMotion:'reduce'});const errors=[];page.on('pageerror',e=>errors.push(String(e)));
  await page.setContent(`<html style="font-size:${scale*16}px"><head><style>${css.css}</style></head><body><div id="root"></div></body></html>`);
  await page.addScriptTag({content:bundle.outputFiles[0].text});await page.waitForFunction(()=>window.fixture.pending.length===1);
  if(status==='reconnecting')await page.evaluate(()=>window.fixture.pending.shift().reject(new Error('Network unavailable')));
  if(status==='ready')await page.evaluate(()=>window.fixture.pending.shift().resolve({admitted:true}));
  await page.waitForFunction(s=>window.fixture.controls.status===s,status);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false,`${width}/${scale}/${status}: no horizontal overflow`);
  assert.match(await page.locator('[role="status"]').textContent(),status==='ready'?/Checking room access/:status==='reconnecting'?/Connection interrupted/:/Checking the host/);
  assert.equal(await page.locator('[data-testid="lynk-waiting-room"]').evaluate(el=>getComputedStyle(el).display),'flex');
  assert.equal(await page.locator('body > #root > div').evaluate(el=>getComputedStyle(el).backgroundColor),'rgb(6, 7, 13)');
  assert.equal(await page.evaluate(()=>document.getAnimations().filter(a=>a.playState==='running').length),0);
  if(process.argv.includes('--screenshots'))await page.screenshot({path:`/tmp/event-lynk-lobby-${name}-${width}-${scale}-${status}.png`,fullPage:true});
  await page.keyboard.press('Tab');assert.equal(await page.locator(':focus').getAttribute('aria-label'),'Back');
  await page.keyboard.press('Tab');
  if(status==='reconnecting'){
   assert.equal(await page.locator(':focus').textContent(),'Check again');await page.keyboard.press('Enter');
   await page.waitForFunction(()=>window.fixture.pending.length===1);await page.waitForFunction(()=>window.fixture.controls.status==='checking');
   // Retry button disappears; refocus the persistent leave control below.
  }
  const leave=page.getByRole('button',{name:'Leave lobby',exact:true});await leave.focus();await leave.scrollIntoViewIfNeeded();
  const rect=await leave.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=width+1&&rect.y>=0&&rect.y+rect.height<=650+1,'leave is reachable by keyboard/scroll');
  assert.ok(rect.height>=44,'touch target');
  await page.keyboard.press('Enter');
  assert.deepEqual(await page.evaluate(()=>window.fixture.actions),['cancel','navigate:/feed/messages']);
  const before=await page.evaluate(()=>window.fixture.admissions);
  await page.evaluate(()=>window.fixture.pending.shift()?.resolve({admitted:true}));await page.waitForTimeout(30);
  assert.equal(await page.evaluate(()=>window.fixture.admissions),before,'late admission after synchronous leave is blocked');
  assert.deepEqual(errors,[]);cases++;await page.close();
 }}finally{await browser.close();}
 console.log(`PASS ${name}: ${cases} extracted production web lobby + real Tailwind/hook cases, widths 320/390/1280, 150% text, reduced motion, recovery, keyboard/scroll and synchronous cancellation. Synthetic boundaries; not full-room integration.`);
})().catch(e=>{console.error(e);process.exitCode=1});
