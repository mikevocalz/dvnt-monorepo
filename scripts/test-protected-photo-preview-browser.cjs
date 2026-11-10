/** Actual web preview component in Chromium; only authenticated service edges are synthetic. */
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
const {build}=require('esbuild');
const root=path.resolve(__dirname,'..'),deps=(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean);
const fixtures={
 'preview-fixture':`import {create} from 'zustand';export const auth=create(()=>({isAuthenticated:false,user:null}));export const state={requests:[],releases:[]};export async function invoke(name,args){state.requests.push({name,...args});return new Promise(resolve=>state.releases.push(resolve))}`,
 '@dvnt/app/lib/stores/auth-store':`export {auth as useAuthStore} from 'preview-fixture';`,
 '@dvnt/app/lib/auth/identity':`import {auth} from 'preview-fixture';export const getAuthIdFromStore=()=>auth.getState().user?.authId;export const requireBetterAuthToken=async()=>auth.getState().user?.authId;`,
 '@dvnt/app/lib/supabase/client':`import {invoke} from 'preview-fixture';export const supabase={functions:{invoke}};`,
};
const entry=`import React from 'react';import {createRoot} from 'react-dom/client';import {ProtectedPhotoPreview} from '${root}/packages/app/components/feed/protected-photo-preview.web.tsx';import {auth,state} from 'preview-fixture';import {publishSessionBoundary} from '@dvnt/app/lib/auth/session-lifecycle';const app=createRoot(document.getElementById('root'));window.fixture={auth,state,render:id=>app.render(<div style={{position:'relative',height:300,width:300}}><ProtectedPhotoPreview postId={id}/></div>),switchUser:id=>{publishSessionBoundary({ready:!!id,authId:id||undefined});auth.setState({isAuthenticated:!!id,user:id?{id,authId:id}:null})}};`;
(async()=>{let browser;const dir=fs.mkdtempSync(path.join(os.tmpdir(),'protected-preview-'));try{
 await build({stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,platform:'browser',format:'iife',jsx:'automatic',define:{__DEV__:'true'},nodePaths:deps,outfile:path.join(dir,'test.js'),plugins:[{name:'service-boundaries',setup(b){b.onResolve({filter:/.*/},a=>{let key=a.path;if(key.startsWith('.'))key='@dvnt/app/'+path.relative(path.join(root,'packages/app'),path.resolve(a.resolveDir,key)).replace(/\\/g,'/');if(fixtures[key])return {path:key,namespace:'fixture'};if(key.startsWith('@dvnt/app/')){const stem=path.join(root,'packages/app',key.slice(10));for(const ext of ['', '.ts','.tsx'])if(fs.existsSync(stem+ext))return {path:stem+ext};}});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixtures[a.path],loader:'tsx',resolveDir:root}));}}]});
 const {chromium}=require(process.env.PLAYWRIGHT_PACKAGE||'playwright');browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});const page=await browser.newPage();const errors=[],network=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>network.push(r.url()));await page.route('**/*',r=>r.abort());await page.setContent('<div id="root"></div>');await page.addScriptTag({path:path.join(dir,'test.js')});
 const settle=()=>page.waitForTimeout(30);
 await page.evaluate(()=>fixture.render('3'));await settle();assert.equal(await page.evaluate(()=>fixture.state.requests.length),0);
 await page.evaluate(()=>fixture.switchUser('a'));await page.waitForFunction(()=>fixture.state.requests.length===1);
 const {Image}=require('imagescript');const img=new Image(48,48);img.fill(0x552277ff);const png='data:image/png;base64,'+Buffer.from(await img.encode()).toString('base64');
 await page.evaluate(()=>fixture.switchUser('b'));await page.waitForFunction(()=>fixture.state.requests.length===2);
 await page.evaluate(png=>fixture.state.releases[0]({data:{preview:png}}),png);await settle();assert.equal(await page.locator('img').count(),0,'A response must not reach B');
 await page.evaluate(png=>fixture.state.releases[1]({data:{preview:png}}),png);await page.locator('img').waitFor();assert.equal(await page.locator('img').getAttribute('src'),png);
 await page.evaluate(()=>fixture.switchUser(null));await page.waitForFunction(()=>!document.querySelector('img'));
 await page.evaluate(()=>fixture.switchUser('a'));await page.waitForFunction(()=>fixture.state.requests.length===3);
 await page.evaluate(()=>fixture.state.releases[2]({data:{preview:'https://cdn.test/post-image/ORIGINAL.jpg'}}));await settle();assert.equal(await page.locator('img').count(),0,'remote originals rejected');
 await page.evaluate(()=>fixture.render('4'));await page.waitForFunction(()=>fixture.state.requests.length===4);await page.evaluate(png=>fixture.state.releases[3]({data:{preview:png}}),png);await page.locator('img').waitFor();
 await page.evaluate(()=>fixture.render('5'));await page.waitForFunction(()=>fixture.state.requests.length===5);assert.equal(await page.locator('img').count(),0,'post switch clears prior preview');await page.evaluate(()=>fixture.state.releases[4]({error:{message:'offline'}}));await settle();assert.equal(await page.locator('img').count(),0);
 assert.deepEqual(errors,[]);assert.equal(network.some(url=>url.includes('ORIGINAL')),false);console.log('PASS actual Chromium preview: guest denial, account/session races, real PNG rendering, signout/post-switch clearing, invalid-source rejection and service-failure fallback');
}finally{await browser?.close();fs.rmSync(dir,{recursive:true,force:true});}})().catch(e=>{console.error(e);process.exitCode=1});
