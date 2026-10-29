#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const paths = [root, ...((process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean))];
const resolve = name => require.resolve(name, { paths });
const load = name => require(resolve(name));
const baseline = process.env.UI_BASELINE === '1';
let components = `import { MessageFilterTabs } from './packages/app/features/messages/message-filter-tabs.web';
import { AvatarLightbox } from './packages/app/features/profile/avatar-lightbox.web';`;
if (baseline) {
  const old = file => execFileSync('git', ['show', 'b57a4dd:'+file], { cwd:root, encoding:'utf8' });
  const messages = old('packages/app/features/messages/messages.web.tsx');
  const nav = messages.slice(messages.indexOf('        <nav\n'), messages.indexOf('\n        </nav>')+15);
  const profile = old('packages/app/features/profile/profile.web.tsx');
  let lightbox = profile.slice(profile.indexOf('        <div\n',profile.indexOf('{/* Avatar lightbox */}')), profile.indexOf('\n      ) : null}',profile.indexOf('{/* Avatar lightbox */}')));
  lightbox = lightbox.replace('<div', '<div role="dialog" aria-label="Profile picture"').replace('aria-label="Close"','aria-label="Close profile picture"');
  components = `import { Inbox, ShieldAlert, Radio, X } from 'lucide-react';
  function MessageFilterTabs({activeTab,onChange:setActiveTab,inboxUnreadCount,spamUnreadCount}) {return (${nav});}
  function AvatarLightbox({src:avatarUri,onClose:setAvatarViewerOpen}) {return (${lightbox});}`;
}
const entry = `import React from 'react'; import {createRoot} from 'react-dom/client'; import {create} from 'zustand';
${components}
const useUI=create(set=>({tab:'primary',open:false,setTab:tab=>set({tab}),setOpen:open=>set({open})}));
const picture='data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="900"><rect width="600" height="900" fill="purple"/></svg>');
function App(){const ui=useUI();return <><header style={{position:'fixed',top:0,left:0,right:0,height:64,zIndex:1000,background:'#111'}}>Global header</header><main style={{padding:'80px 16px',minHeight:'160vh',transform:'translateZ(0)'}}>
<MessageFilterTabs activeTab={ui.tab} onChange={ui.setTab} inboxUnreadCount={999} spamUnreadCount={999}/><p data-active>{ui.tab}</p>
<button id="avatar" onClick={()=>ui.setOpen(true)}>Open avatar</button>
{ui.open && <AvatarLightbox src={picture} onClose={()=>ui.setOpen(false)}/>}</main><footer style={{position:'fixed',bottom:0,height:56,left:0,right:0,zIndex:1000,background:'#111'}}>Global tabs</footer></>}
createRoot(document.getElementById('root')).render(<App/>);`;
async function main(){
 for (const file of ['profile.web.tsx','user-profile.web.tsx']) assert.match(fs.readFileSync(path.join(root,'packages/app/features/profile',file),'utf8'), /<AvatarLightbox src=/);
 assert.match(fs.readFileSync(path.join(root,'packages/app/features/messages/messages.web.tsx'),'utf8'), /<MessageFilterTabs activeTab=/);
 const bundle=await load('esbuild').build({stdin:{contents:entry,resolveDir:root,sourcefile:'fixture.tsx',loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',nodePaths:paths,define:{'process.env.NODE_ENV':'"test"'}});
 const tw=path.dirname(resolve('tailwindcss/package.json'));
 const css=await load('postcss')([load('@tailwindcss/postcss')({base:root})]).process(`@import "${tw}/theme.css" layer(theme);@import "${tw}/preflight.css" layer(base);@import "${tw}/utilities.css" important;@source "${root}/packages/app/features/messages";@source "${root}/packages/app/features/profile";`,{from:path.join(root,'fixture.css')});
 const server=http.createServer((req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<html><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${css.css} body{background:#06070d;color:white}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script></html>`)});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const engine=process.env.UI_BROWSER || 'chromium';const browser=await load('@playwright/test')[engine].launch({headless:true});
 const out=process.env.UI_EVIDENCE || '/tmp/tabs-avatar-evidence';fs.mkdirSync(out,{recursive:true});
 try {for(const width of [320,375,390,430,768,1024]){
 const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto(`http://127.0.0.1:${server.address().port}`);const nav=page.getByRole('navigation',{name:'Message filters'});await nav.waitFor();
 const n=await nav.boundingBox();const buttons=nav.getByRole('button');
 if(!process.env.UI_ONLY_LIGHTBOX)for(let i=0;i<3;i++){const b=await buttons.nth(i).boundingBox();assert(b.x>=n.x&&b.x+b.width<=n.x+n.width+1,'tab outside container');assert(b.height>=44,'tab touch target');await buttons.nth(i).click();if(!baseline)assert.equal(await buttons.nth(i).getAttribute('aria-pressed'),'true');}
 if(!process.env.UI_ONLY_LIGHTBOX)assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'page overflows horizontally');
 await page.evaluate(()=>document.documentElement.style.fontSize='32px');
 if(!process.env.UI_ONLY_LIGHTBOX)assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'200% text overflows horizontally');
 if(!process.env.UI_ONLY_LIGHTBOX)for(let i=0;i<3;i++){const b=await buttons.nth(i).boundingBox();assert(b.x+b.width<=width,'large text tab outside viewport');}
 await page.evaluate(()=>document.documentElement.style.fontSize='');
 await page.screenshot({path:path.join(out,`${engine}-${width}-tabs.png`)});
 for(const dismissal of ['button','escape','backdrop','back']){
 await page.locator('#avatar').click();const dialog=page.getByRole('dialog',{name:'Profile picture'});await dialog.waitFor();const close=page.getByRole('button',{name:'Close profile picture'});const box=await close.boundingBox();
 assert(box.x>=0&&box.y>=0&&box.x+box.width<=width&&box.y+box.height<=844,'close outside viewport');if(!baseline)assert(box.width>=44&&box.height>=44,'close touch target');
 assert(await close.evaluate(el=>{const r=el.getBoundingClientRect();return [0.1,0.5,0.9].every(y=>el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height*y)))}),'close occluded by app chrome');
 assert.equal(await page.evaluate(()=>document.body.style.overflow),'hidden');
 await page.keyboard.press('Tab');assert(await dialog.evaluate(el=>el.contains(document.activeElement)),'focus escaped modal');
 await page.screenshot({path:path.join(out,`${engine}-${width}-avatar.png`)});
 if(dismissal==='button')await close.click();else if(dismissal==='escape')await page.keyboard.press('Escape');else if(dismissal==='back')await page.evaluate(()=>window.dispatchEvent(new PopStateEvent('popstate')));else await page.mouse.click(2,120);
 await dialog.waitFor({state:'detached'});assert.equal(await page.evaluate(()=>document.body.style.overflow),'');assert.equal(await page.evaluate(()=>document.activeElement?.id),'avatar');
 }
 await page.locator('#avatar').click();await page.setViewportSize({width:844,height:width});const close=page.getByRole('button',{name:'Close profile picture'});await close.click();
 assert.deepEqual(errors,[]);await page.close();console.log('PASS',engine,width,'tabs and modal reopen/dismiss/orientation');
 }}finally{await browser.close();server.close();}
}
main().catch(e=>{console.error(e);process.exit(1)});
