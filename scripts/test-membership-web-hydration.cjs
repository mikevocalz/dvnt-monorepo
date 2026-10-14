/** Real browser hook regression with fixture auth/database boundaries only. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const esbuild = require('esbuild');
const authStub=`const React=require('react');
export const useAuthStore=(selector)=>React.useSyncExternalStore(cb=>{globalThis.__membershipListeners.add(cb);return()=>globalThis.__membershipListeners.delete(cb);},()=>selector(globalThis.__membershipState),()=>selector(globalThis.__membershipState));
useAuthStore.getState=()=>globalThis.__membershipState;`;
const databaseStub=`export const supabase={from(table){return {select(){return {eq(column,value){
if(!globalThis.__membershipBridged)throw new Error('Query before authentication');
if(table==='users')return Promise.resolve({data:value==='fixture-owner'?[{id:11,auth_id:'fixture-owner'}]:[],error:null});
return Promise.resolve({data:table==='membership_grant_records'?[{product_family:'dvnt_membership',plan_key:'dvnt_vip',status:'active',rail:null,source:'complimentary',current_period_end:null}]:[],error:null});
},in(){return Promise.resolve({data:[],error:null});}}}}}};`;

(async()=>{
 const build=await esbuild.build({stdin:{contents:`
import React from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {useEntitlements} from './packages/app/lib/subscription/use-entitlements';
import {lynkCreateSummary} from './packages/app/lib/subscription/lynk-create-summary';
globalThis.__membershipState={user:{id:'11',authId:'fixture-owner'},_hasHydrated:true,isAuthenticated:true,authStatus:'loading'};
globalThis.__membershipListeners=new Set();globalThis.__membershipBridged=false;
const client=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0}}});
function Probe(){const summary=lynkCreateSummary(useEntitlements());return React.createElement('p',null,summary.title+' '+summary.description);}
const root=createRoot(document.getElementById('root'));
root.render(React.createElement(QueryClientProvider,{client},React.createElement(Probe)));
window.logout=()=>{globalThis.__membershipState={user:null,_hasHydrated:true,isAuthenticated:false,authStatus:'unauthenticated'};for(const notify of globalThis.__membershipListeners)notify();};
window.cleanup=()=>{root.unmount();client.clear();};
`,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'fixture-boundaries',setup(build){
 build.onResolve({filter:/^(react-native|@dvnt\/app\/lib\/stores\/auth-store|@dvnt\/app\/lib\/supabase\/client)$|supabase-jwt$/},args=>({path:args.path,namespace:'fixtures'}));
 build.onLoad({filter:/.*/,namespace:'fixtures'},args=>({contents:args.path==='react-native'?`export const Platform={OS:'web'};`:args.path.includes('auth-store')?authStub:args.path.includes('supabase-jwt')?`export async function ensureSupabaseJwt(){globalThis.__membershipBridged=true;return true;}`:databaseStub,loader:'js'}));
 build.onResolve({filter:/^(react|react-dom\/client|@tanstack\/react-query)$/},args=>({path:require.resolve(args.path)}));
 }}]});
 const html='<html><body><div id="root"></div></body></html>';
 if(process.argv.includes('--dom')) {
   const {JSDOM}=require('jsdom');
   const dom=new JSDOM(html,{url:'https://example.test',runScripts:'dangerously'});
   try {
     dom.window.eval(build.outputFiles[0].text);
     const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Membership UI did not settle');};
     await until(()=>dom.window.document.body.textContent.includes('VIP · Lynk included'));
     dom.window.logout();
     await until(()=>!dom.window.document.body.textContent.includes('VIP · Lynk included'));
     dom.window.cleanup();
   } finally {dom.window.close();}
 } else {
   let chromium;try{({chromium}=require('playwright'));}catch{({chromium}=require('@playwright/test'));}
   const server=http.createServer((req,res)=>{if(req.url==='/bundle.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(build.outputFiles[0].contents);}else{res.writeHead(200,{'Content-Type':'text/html'});res.end(html+'<script src="/bundle.js"></script>');}});
   await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
   let browser;
   try {
     browser=await chromium.launch({headless:true,...(fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{}),args:['--no-sandbox','--disable-dev-shm-usage']});
     const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
     await page.goto(`http://127.0.0.1:${server.address().port}`);
     await page.waitForFunction(()=>document.body.textContent.includes('VIP · Lynk included'));
     assert.doesNotMatch(await page.locator('body').innerText(),/Loading your membership/);
     await page.evaluate(()=>window.logout());
     await page.waitForFunction(()=>!document.body.textContent.includes('VIP · Lynk included'));
     assert.deepEqual(errors,[]);
     await page.evaluate(()=>window.cleanup());
   } finally {if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
 }
 console.log('PASS: restored web login resolves VIP through real React Query; logout clears the displayed plan');
})().catch(error=>{console.error(error);process.exitCode=1;});
