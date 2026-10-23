#!/usr/bin/env node
// Actual shared composer + threaded comment rows; auth/mutation are offline fixtures.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {execFileSync} = require('node:child_process');
const keyboardBaseline = process.argv.includes('--keyboard-baseline');
const {build} = require('esbuild');
const {compile} = require('tailwindcss');
const {chromium,webkit} = require('playwright');
const root = path.resolve(__dirname, '..');
const dir = process.env.COMMENT_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'dvnt-comments-'));
fs.mkdirSync(dir,{recursive:true});

// A real, visible, looping two-frame GIF. All pixels and LZW bytes are generated
// here, so visual QA never depends on provider availability or a transparent dot.
function animatedGif(width = 80, height = 60) {
 const word = value => [value & 255, value >> 8];
 const bytes = [...Buffer.from('GIF89a'), ...word(width), ...word(height), 0x91, 0, 0,
  17, 26, 48, 46, 219, 221, 255, 97, 150, 255, 218, 102,
  0x21, 0xff, 11, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0];
 for (let frame = 0; frame < 2; frame++) {
  // Clear before each pixel keeps code width at three bits. This deliberately
  // simple encoder favors an inspectable fixture over compression efficiency.
  const codes = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
   const edge = x < width * .06 || x >= width * .94 || y < height * .08 || y >= height * .92;
   const circle = ((x / width - (frame ? .63 : .37)) / .22) ** 2 + ((y / height - .5) / .30) ** 2 < 1;
   const color = edge ? 0 : circle ? 3 : (Math.floor(x / (width / 5)) + Math.floor(y / (height / 4)) + frame) % 2 + 1;
   codes.push(4, color);
  }
  codes.push(5);
  const data = []; let bits = 0, count = 0;
  for (const code of codes) { bits |= code << count; count += 3; while (count >= 8) { data.push(bits & 255); bits >>= 8; count -= 8; } }
  if (count) data.push(bits & 255);
  bytes.push(0x21, 0xf9, 4, 8, 30, 0, 0, 0, 0x2c, 0, 0, 0, 0, ...word(width), ...word(height), 0, 2);
  for (let offset = 0; offset < data.length; offset += 255) { const chunk = data.slice(offset, offset + 255); bytes.push(chunk.length, ...chunk); }
  bytes.push(0);
 }
 bytes.push(0x3b);
 return Buffer.from(bytes);
}
const gifFixtures = { normal: animatedGif(), tall: animatedGif(60, 180), wide: animatedGif(240, 60) };
fs.writeFileSync(path.join(dir, 'visible-two-frame.gif'), gifFixtures.normal);

const mocks = {
 '../../stickers/api/klipy': `const item=(id,title,width=160,height=120)=>({id,title,media_formats:{gif:{url:'https://static.klipy.com/'+id+'.gif',width,height}}});export const getItemImageUri=item=>item.media_formats.gif.url;export const getItemPreviewUri=getItemImageUri;export const klipySearch=async (_kind,query,options)=>{window.gifRequests.push({query,next:options.next});if(query==='slow')await new Promise(resolve=>window.releaseSlowGif=resolve);if(query==='error'&&!window.gifRecovered)throw Error('offline provider failure');if(query==='empty')return {results:[],source:'klipy'};if(query==='fallback')return {results:[{...item('noto','Noto smile'),media_formats:{gif:{url:'https://fonts.gstatic.com/s/e/notoemoji/latest/1f600/512.gif',width:160,height:120}}}],source:'fallback'};if(query==='slow')return {results:[item('stale','Stale result')],source:'klipy'};if(query==='gallery'){if(options.next&&window.pauseNextGif)await new Promise(resolve=>window.releaseNextGif=resolve);return {results:options.next?[item('tall','Tall celebration',120,360),item('last','Final wave')]:[item('tall','Tall celebration',120,360),item('wide','Wide celebration',480,120),...Array.from({length:12},(_,i)=>item('gallery-'+i,'Celebration '+(i+1)))],next:options.next?undefined:'gallery-2',source:'klipy'};}if(query)return {results:[item('search','Search wave')],source:'klipy'};return {results:options.next?[item('wave','Wave'),item('dance','Dance')]:[item('wave','Wave')],next:options.next?undefined:'page-2',source:'klipy'};};`,
 'solito/navigation': `export const useParams=()=>({postId:'fixture-post',commentId:'17'});export const useRouter=()=>({back(){},push(){}});`,
 '@dvnt/app/lib/hooks/use-comments': `import {useMutation} from '@tanstack/react-query'; const comment={id:'17',username:'deviantevents',text:'🔥🔥🔥',timeAgo:'12h',attachment:{provider:'klipy',id:'saved',url:'https://static.klipy.com/saved.gif',previewUrl:'https://static.klipy.com/saved.gif',width:160,height:120,title:'Saved wave'},replies:[]};export const useComments=()=>({data:[comment],isLoading:false});export const useCommentThread=()=>({data:{parentComment:comment,replies:[]},isLoading:false});export const useCreateComment=()=>useMutation({mutationFn:async data=>{window.calls.push(data);await new Promise(resolve=>window.release=resolve);if(window.fail)throw Error('offline fixture failure');return {id:'created'};}});`,
 '@dvnt/app/lib/hooks/use-verified-gate': `export const useVerifiedGate=()=> (_action,run)=>{if(window.deferGate)window.finishGate=run;else if(!window.blocked)run()};`,
 '@dvnt/app/lib/stores/auth-store': `import {create} from 'zustand';export const useAuthStore=create(()=>({user:{id:'fixture-author',username:'viewer'}}));window.auth=useAuthStore;`,
 '@dvnt/app/lib/hooks/use-comment-like-state': `export const useCommentLikeState=()=>({likesCount:1,hasLiked:false,toggle(){},isPending:false});`,
 '@dvnt/app/components/ui/avatar': `export const UserAvatar=()=> <div style={{width:36,height:36,background:'#222',borderRadius:8}}/>;`,
 './delete-comment-action': `export const DeleteCommentAction=()=>null;`,
};

async function noHorizontalOverflow(page, label) {
 const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
 assert(sizes.document <= sizes.viewport && sizes.body <= sizes.viewport, `${label}: horizontal overflow ${JSON.stringify(sizes)}`);
}
async function touchTarget(locator, label) {
 const bounds = await locator.boundingBox();
 assert(bounds && bounds.width >= 44 && bounds.height >= 44, `${label}: expected at least 44×44 CSS px, got ${JSON.stringify(bounds)}`);
}
async function loadedImage(locator) {
 await locator.scrollIntoViewIfNeeded();
 await locator.evaluate(image => image.decode());
 assert(await locator.evaluate(image => image.naturalWidth > 1 && image.naturalHeight > 1), 'visible GIF fixture must decode at its real dimensions');
}
// This models OS keyboard visualViewport events while keeping the layout
// viewport unchanged. It is not a physical-device keyboard emulation.
async function checkVisualViewportKeyboard(page, width, baseline = false) {
 await page.evaluate(() => {
  window.originalVisualViewport = Object.getOwnPropertyDescriptor(window, 'visualViewport');
  const viewport = Object.assign(new EventTarget(), {height:innerHeight,width:innerWidth,offsetTop:0,offsetLeft:0,scale:1,pageTop:scrollY});
  Object.defineProperty(window,'visualViewport',{configurable:true,value:viewport});
  window.keyboardScrolls = [];
  window.originalScrollBy = window.scrollBy;
  window.scrollBy = (...args) => {keyboardScrolls.push(args);return originalScrollBy.apply(window,args)};
  const shade = document.createElement('div');
  shade.id='keyboard-occlusion';shade.ariaHidden='true';
  shade.style.cssText='position:fixed;left:0;right:0;bottom:0;z-index:9999;pointer-events:none;background:#202332;border-top:1px solid #667;color:white;font:14px Arial;padding:12px;box-sizing:border-box;display:none';
  shade.textContent='Synthetic keyboard occlusion (not a device keyboard)';document.body.append(shade);
  window.setKeyboardViewport = (height,offsetTop=0) => {
   Object.assign(viewport,{height,offsetTop});
   shade.style.display=height<innerHeight?'block':'none';shade.style.top=(height+offsetTop)+'px';
   viewport.dispatchEvent(new Event('resize'));viewport.dispatchEvent(new Event('scroll'));
  };
 });
 const measure = () => page.evaluate(() => {
  const rect = selector => {const r=document.querySelector(selector)?.getBoundingClientRect();return r?{top:r.top,bottom:r.bottom,height:r.height}:null};
  const view={height:visualViewport.height,top:visualViewport.offsetTop,bottom:visualViewport.offsetTop+visualViewport.height};
  return {layoutHeight:innerHeight,view,textarea:rect('textarea'),picker:rect('[aria-label="Choose a GIF"]'),search:rect('[aria-label="Search GIFs"]'),gallery:rect('[aria-label="Choose a GIF"] [aria-busy]'),clearance:document.querySelector('[aria-label="Comment composer"]')?.style.getPropertyValue('--comment-keyboard-clearance'),active:document.activeElement?.getAttribute('aria-label'),scrolls:keyboardScrolls.length};
 });
 const settle = () => page.evaluate(() => new Promise(resolve => requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const waitVisible = selector => page.waitForFunction(selector => {
  const target=document.querySelector(selector);if(!target)return false;
  const r=target.getBoundingClientRect();return r.top>=visualViewport.offsetTop+7 && r.bottom<=visualViewport.offsetTop+visualViewport.height-7;
 },selector);
 const measurements = [];
 await page.locator('#comment-trigger').click();
 const input=page.getByRole('textbox',{name:'Add a comment',exact:true});await input.fill('Keyboard draft stays intact');
 await page.evaluate(()=>setKeyboardViewport(320,80));await settle();
 if(!baseline) await waitVisible('textarea');
 measurements.push({state:'textarea-keyboard',...await measure()});
 await page.screenshot({path:path.join(dir,`keyboard-${baseline?'baseline-':''}textarea-${width}.png`)});
 await page.getByRole('button',{name:'Add GIF',exact:true}).click();
 const search=page.getByRole('textbox',{name:'Search GIFs',exact:true});await search.fill('gallery');
 await page.getByRole('button',{name:'Choose Celebration 12',exact:true}).waitFor();
 await page.evaluate(()=>setKeyboardViewport(300,40));await settle();
 if(!baseline) await waitVisible('[aria-label="Choose a GIF"]');
 const keyboard=await measure();measurements.push({state:'picker-keyboard',...keyboard});
 assert.equal(keyboard.layoutHeight,852,'OS keyboard case must not resize innerHeight/dvh');
 await page.screenshot({path:path.join(dir,`keyboard-${baseline?'baseline-':''}picker-${width}.png`)});
 if(baseline) {
  assert(measurements[0].textarea.bottom>measurements[0].view.bottom,'baseline plain textarea reproduces keyboard clipping');
  assert(keyboard.picker.bottom>keyboard.view.bottom || keyboard.search.top<keyboard.view.top,'baseline picker reproduces visual viewport clipping');
  fs.writeFileSync(path.join(dir,`keyboard-baseline-geometry-${width}.json`),JSON.stringify(measurements,null,2));
  return;
 }
 assert.equal(keyboard.active,'Search GIFs','viewport resize preserves search focus');
 assert(keyboard.gallery.height<=121,'gallery uses visualViewport height, not unchanged dvh');
 assert.equal(await input.inputValue(),'Keyboard draft stays intact');
 // Offset-only scroll, not a resize: keyboard/browser panning must be handled.
 await page.evaluate(()=>{visualViewport.offsetTop=180;document.querySelector('#keyboard-occlusion').style.top='480px';visualViewport.dispatchEvent(new Event('scroll'))});
 await waitVisible('[aria-label="Choose a GIF"]');
 measurements.push({state:'offset-only-pan',...await measure()});
 const before=await page.evaluate(()=>keyboardScrolls.length);
 await page.evaluate(()=>{visualViewport.pageTop+=80;for(let i=0;i<8;i++)visualViewport.dispatchEvent(new Event('scroll'))});await settle();
 assert.equal(await page.evaluate(()=>keyboardScrolls.length),before,'unchanged viewport scroll events do not create a correction loop');
 await page.evaluate(()=>setKeyboardViewport(852));await waitVisible('[aria-label="Choose a GIF"]');
 await page.waitForFunction(()=>document.querySelector('[aria-label="Comment composer"]').style.getPropertyValue('--comment-keyboard-clearance')==='0px');
 assert.equal(await search.evaluate(el=>el===document.activeElement),true,'keyboard dismissal does not blur search');
 measurements.push({state:'keyboard-dismissed',...await measure()});
 // Select without a Playwright auto-scroll that could hide application bugs.
 await page.evaluate(()=>{setKeyboardViewport(300,40);document.querySelector('[aria-label="Choose Wide celebration"]').click()});
 await page.getByRole('region',{name:'Choose a GIF',exact:true}).waitFor({state:'detached'});
 await input.evaluate(el=>el.focus({preventScroll:true}));await waitVisible('textarea');
 assert.equal(await input.inputValue(),'Keyboard draft stays intact');
 assert.equal(await page.evaluate(()=>draft.getState().attachment.id),'wide');
 measurements.push({state:'selected-gif-textarea',...await measure()});
 await page.screenshot({path:path.join(dir,`keyboard-selected-textarea-${width}.png`)});
 await page.getByRole('button',{name:'Close composer',exact:true}).evaluate(el=>el.click());await input.waitFor({state:'detached'});await settle();
 const closed=await page.evaluate(()=>keyboardScrolls.length);
 await page.evaluate(()=>setKeyboardViewport(280,0));await settle();
 assert.equal(await page.evaluate(()=>keyboardScrolls.length),closed,'dismissed composer detaches keyboard handling');
 fs.writeFileSync(path.join(dir,`keyboard-geometry-${width}.json`),JSON.stringify(measurements,null,2));
 await page.evaluate(()=>{
  Object.defineProperty(window,'visualViewport',originalVisualViewport);window.scrollBy=originalScrollBy;
  document.querySelector('#keyboard-occlusion').remove();delete window.setKeyboardViewport;
 });
}

async function checkMobileGifQuality(page, width) {
 const screenshot = async (state, fullPage = true) => page.screenshot({ path: path.join(dir, `mobile-${state}-${width}.png`), fullPage });
 await page.setViewportSize({width,height:852});
 await page.evaluate(() => { window.fail=false; window.gifRecovered=false; window.deferGate=false; draft.getState().reset(); mount(undefined,true); });
 await page.locator('#comment-trigger').click();
 const composer = page.locator('[aria-label="Comment composer"]');
 const add = page.getByRole('button',{name:'Add GIF',exact:true});
 const close = page.getByRole('button',{name:'Close composer',exact:true});
 const post = page.getByRole('button',{name:'Post comment',exact:true});
 await touchTarget(add,'Add GIF'); await touchTarget(close,'Close composer'); await touchTarget(post,'Post comment');
 await add.click();
 const picker = page.getByRole('region',{name:'Choose a GIF',exact:true});
 const search = page.getByRole('textbox',{name:'Search GIFs',exact:true});
 await search.waitFor();
 assert.equal(await search.evaluate(el => el === document.activeElement),true,'picker search receives focus');
 assert(await search.evaluate(el => parseFloat(getComputedStyle(el).fontSize) >= 16),'16px search text avoids iOS focus zoom');
 await touchTarget(search,'GIF search');
 await touchTarget(page.getByRole('button',{name:'Close GIF picker',exact:true}),'Close GIF picker');
 await search.press('Tab');
 const keyboardFocus = await page.getByRole('button',{name:'Close GIF picker',exact:true}).evaluate(el => ({active:el===document.activeElement,visible:el.matches(':focus-visible'),outline:getComputedStyle(el).outlineStyle}));
 assert(keyboardFocus.active && keyboardFocus.visible && keyboardFocus.outline !== 'none','picker close has a visible keyboard-focus indicator');
 await search.fill('gallery');
 await page.getByRole('button',{name:'Choose Celebration 12',exact:true}).waitFor();
 const results = picker.locator('[aria-busy]');
 const scroll = await results.evaluate(el => ({scroll:el.scrollHeight,client:el.clientHeight,overscroll:getComputedStyle(el).overscrollBehaviorY}));
 assert(scroll.scroll > scroll.client,'gallery must exercise a real scroll container');
 assert.equal(scroll.overscroll,'contain','picker contains scroll chaining');
 await loadedImage(page.getByRole('img',{name:'Tall celebration',exact:true}));
 await loadedImage(page.getByRole('img',{name:'Wide celebration',exact:true}));
 await touchTarget(page.getByRole('button',{name:'Choose Tall celebration',exact:true}),'GIF result');
 await results.evaluate(el => {el.scrollTop=0});
 await picker.scrollIntoViewIfNeeded(); await noHorizontalOverflow(page,'populated picker'); await screenshot('picker');
 await page.evaluate(() => {window.pauseNextGif=true;window.releaseNextGif=undefined});
 await page.getByRole('button',{name:'Load more GIFs',exact:true}).click();
 await page.waitForFunction(() => !!window.releaseNextGif);
 assert.equal(await results.getAttribute('aria-busy'),'true');
 assert.equal(await page.getByRole('button',{name:'Choose Tall celebration',exact:true}).count(),1,'pagination retains existing tiles while loading');
 await page.getByRole('status').filter({hasText:'Loading GIFs'}).waitFor(); await screenshot('pagination-loading');
 await page.evaluate(() => {window.pauseNextGif=false;releaseNextGif()});
 await page.getByRole('button',{name:'Choose Final wave',exact:true}).waitFor();
 assert.equal(await page.getByRole('button',{name:'Choose Tall celebration',exact:true}).count(),1,'gallery pagination deduplicates attachments');
 await search.fill('error'); await page.getByRole('alert').filter({hasText:'GIFs could not load'}).waitFor();
 await touchTarget(page.getByRole('button',{name:'Retry',exact:true}),'Retry GIF search');
 await picker.scrollIntoViewIfNeeded(); await screenshot('picker-error'); await noHorizontalOverflow(page,'picker error');
 await page.evaluate(() => {window.gifRecovered=true}); await page.getByRole('button',{name:'Retry',exact:true}).click();
 await page.getByRole('button',{name:'Choose Search wave',exact:true}).waitFor();
 await search.press('Escape'); await picker.waitFor({state:'detached'});
 await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Add GIF');
 await add.click(); await search.waitFor(); await page.getByRole('button',{name:'Close GIF picker',exact:true}).click();
 await picker.waitFor({state:'detached'}); assert.equal(await composer.count(),1,'picker close does not discard composer');

 const longTitle = 'Celebration'.repeat(20).slice(0,200);
 const longUser = 'mobile_reply_target_'.repeat(6);
 const longCaption = 'A long mobile caption with context and a GIF. '.repeat(10)+'unbroken_caption_'.repeat(12);
 await page.evaluate(({longUser,longCaption}) => {draft.getState().setReplyTo({commentId:'mobile-target',username:longUser});draft.getState().setText(longCaption)}, {longUser,longCaption});
 const reply = page.getByRole('textbox',{name:`Reply to ${longUser}`,exact:true}); await reply.waitFor();
 await touchTarget(page.getByRole('button',{name:'Cancel reply',exact:true}),'Cancel reply');
 for (const shape of ['tall','wide']) {
  await page.evaluate(({shape,longTitle}) => draft.getState().setAttachment({...fixtureGif,id:shape,url:`https://static.klipy.com/${shape}.gif`,previewUrl:`https://static.klipy.com/${shape}.gif`,width:shape==='tall'?120:480,height:shape==='tall'?360:120,title:longTitle}),{shape,longTitle});
  const gif = page.getByRole('img',{name:longTitle,exact:true}); await loadedImage(gif);
  const bounds = await gif.boundingBox(); assert(bounds.width <= width-24 && bounds.height <= 280,'preview bounds fit mobile composer');
  await touchTarget(page.getByRole('button',{name:'Remove GIF',exact:true}),'Remove GIF');
  await noHorizontalOverflow(page,`${shape} GIF with long caption/reply target`); await screenshot(`${shape}-preview`);
 }
 await page.getByRole('button',{name:'Cancel reply',exact:true}).click();
 const input = page.getByRole('textbox',{name:'Add a comment',exact:true}); await input.waitFor();
 assert.equal(await input.inputValue(),longCaption,'cancel reply preserves caption');
 assert.equal(await page.evaluate(() => draft.getState().attachment.id),'wide','cancel reply preserves GIF');
 await page.getByRole('button',{name:'Remove GIF',exact:true}).click();
 assert.equal(await input.inputValue(),longCaption,'remove GIF preserves caption');
 assert.equal(await page.evaluate(() => draft.getState().attachment),null);
 await page.evaluate(() => {draft.getState().setAttachment(fixtureGif);window.fail=true});
 const before = await page.evaluate(() => calls.length);
 await post.click(); await page.waitForFunction(n => calls.length === n+1,before);
 // React Query notifies React after mutationFn starts. Await the rendered
 // pending state before inspecting controls; the request remains unresolved.
 await composer.locator('form[aria-busy="true"]').waitFor();
 assert.equal(await post.isDisabled(),true); assert.equal(await close.isDisabled(),true); assert.equal(await add.isDisabled(),true);
 assert.equal(await page.getByRole('button',{name:'Remove GIF',exact:true}).isDisabled(),true); assert.equal(await input.isDisabled(),true);
 await composer.locator('form').evaluate(el => el.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));
 assert.equal(await page.evaluate(() => calls.length),before+1,'pending submit cannot duplicate mutation');
 await screenshot('posting'); await page.evaluate(() => release());
 await page.getByRole('alert').filter({hasText:'Could not post'}).waitFor(); await screenshot('post-error');
 assert.equal(await input.inputValue(),longCaption); assert.equal(await page.evaluate(() => draft.getState().attachment.id),'saved');
 await page.evaluate(() => {window.fail=false}); await post.click(); await page.waitForFunction(n => calls.length === n+2,before);
 await page.evaluate(() => release()); await input.waitFor({state:'detached'});

 // Verify actual in-flow layout in short available viewports. These are not
 // physical keyboard, native tab bar, device safe-area, or device Safari tests.
 for (const size of [{width,height:360,kind:'short'}, {width:Math.max(568,width*2),height:320,kind:'landscape'}]) {
  await page.setViewportSize({width:size.width,height:size.height});
  await page.evaluate(() => {draft.getState().reset();mount(undefined,true)});
  await page.locator('#comment-trigger').click(); await add.click(); await search.fill('gallery');
  await page.getByRole('button',{name:'Choose Wide celebration',exact:true}).waitFor();
  await page.waitForFunction(() => {
   const gallery = document.querySelector('[aria-label="Choose a GIF"] [aria-busy]');
   if (!gallery) return false;
   const rect = gallery.getBoundingClientRect();
   return rect.top >= 0 && rect.bottom <= innerHeight;
  });
  for (const control of [search,page.getByRole('button',{name:'Close GIF picker',exact:true})]) {
   const rect = await control.boundingBox();
   assert(rect && rect.y >= 0 && rect.y + rect.height <= size.height, 'short picker keeps search and Close visible with gallery');
  }
  await noHorizontalOverflow(page,`${size.kind} picker`);
  const geometry = await results.evaluate(el => ({height:el.clientHeight,viewport:innerHeight}));
  assert(geometry.height <= geometry.viewport*.4+1,'short picker scroll region leaves room for controls');
  await screenshot(`${size.kind}-picker-viewport`,false);
  await page.getByRole('button',{name:'Choose Wide celebration',exact:true}).click(); await loadedImage(page.getByRole('img',{name:'Wide celebration',exact:true}));
  await post.scrollIntoViewIfNeeded(); await screenshot(`${size.kind}-preview-viewport`,false); await noHorizontalOverflow(page,`${size.kind} preview`);
  const clearance = await composer.evaluate(el => ({padding:parseFloat(getComputedStyle(el).paddingBottom),setting:parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dvnt-tabbar-clearance'))||0}));
  assert(clearance.padding >= clearance.setting+16,'composer honors configured bottom-clearance CSS');
 }
 await page.setViewportSize({width,height:852});
 await page.evaluate(({longTitle}) => {window.fixtureGif={...fixtureGif,title:longTitle};mountGif()}, {longTitle});
 await loadedImage(page.getByRole('img',{name:longTitle,exact:true})); await noHorizontalOverflow(page,'saved long-title GIF'); await screenshot('saved-render');
 await page.emulateMedia({reducedMotion:'reduce'});
 const play = page.getByRole('button',{name:`Play GIF: ${longTitle}`,exact:true}); await play.waitFor();
 assert.equal(await page.getByRole('img',{name:longTitle,exact:true}).count(),0,'reduced motion renders no automatic animation');
 await touchTarget(play,'Play GIF'); await noHorizontalOverflow(page,'unbroken reduced-motion title'); await screenshot('reduced-motion');
 await play.click(); await loadedImage(page.getByRole('img',{name:longTitle,exact:true}));
 await touchTarget(page.getByRole('button',{name:'Stop GIF',exact:true}),'Stop GIF');
 await page.getByRole('button',{name:'Stop GIF',exact:true}).click(); await play.waitFor();
 await page.emulateMedia({reducedMotion:'no-preference'});
 await page.getByRole('img',{name:longTitle,exact:true}).dispatchEvent('error');
 await page.getByText(`GIF unavailable: ${longTitle}`,{exact:true}).waitFor();
 await noHorizontalOverflow(page,'unbroken unavailable-GIF title'); await screenshot('broken-image');
}
(async()=>{
 let browser,server;
 try {
 await build({bundle:true,jsx:'automatic',tsconfigRaw:{},platform:'browser',format:'iife',outfile:path.join(dir,'app.js'),
 resolveExtensions:['.web.tsx','.web.ts','.tsx','.ts','.jsx','.js','.json'],
 nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),
 alias:{'@dvnt/app':path.join(root,'packages/app'),'react-native':'react-native-web','lucide-react-native':'lucide-react'},
 plugins:[{name:'offline-boundaries',setup(b){if(keyboardBaseline)b.onLoad({filter:/comment-(?:composer|gif)\.web\.tsx$/},args=>({contents:execFileSync('git',['show','a1946d10:'+path.relative(root,args.path)],{cwd:root,encoding:'utf8'}),loader:'tsx',resolveDir:path.dirname(args.path)}));b.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'mock'}:null);b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:root}));}}],
 stdin:{resolveDir:root,loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
 import {CommentsScreen} from './packages/app/features/comments/comments.web';import {CommentRepliesScreen} from './packages/app/features/comments/comment-replies.web';
 import {WebCommentComposer} from './packages/app/features/comments/ui/comment-composer.web';
 import {ThreadedComment} from './packages/app/features/comments/ui/threaded-comment';
 import {useCommentDraftStore} from './packages/app/lib/stores/comment-draft-store';
 const client=new QueryClient({defaultOptions:{mutations:{retry:false}}}); const root=createRoot(document.getElementById('root'));
 window.fixtureGif={provider:'klipy',id:'saved',url:'https://static.klipy.com/saved.gif',previewUrl:'https://static.klipy.com/saved.gif',width:160,height:120,title:'Saved wave'};window.gifRequests=[];window.calls=[];window.draft=useCommentDraftStore;window.cleanup=()=>{root.unmount();client.clear()};
 const comment={id:'17',username:'deviantevents',text:'🔥🔥🔥',timeAgo:'12h',replies:[]};
 window.mount=(parentCommentId,hideWhenClosed=false)=>root.render(<React.StrictMode><QueryClientProvider client={client}><main style={{maxWidth:600,margin:'auto'}}><div style={{height:380,background:'#12141d'}}>Post media fixture</div><button id="comment-trigger" onClick={()=>useCommentDraftStore.getState().openComposer()}>Comment</button><div id="comment-card"><ThreadedComment comment={comment} postId="fixture-post" onReply={(username,commentId)=>useCommentDraftStore.getState().setReplyTo({username,commentId})} onProfilePress={()=>{}}/></div><WebCommentComposer key={parentCommentId||'post'} postId="fixture-post" parentCommentId={parentCommentId} hideWhenClosed={hideWhenClosed}/></main></QueryClientProvider></React.StrictMode>);
 window.mountGif=()=>root.render(<React.StrictMode><QueryClientProvider client={client}><ThreadedComment comment={{...comment,attachment:window.fixtureGif}} postId="fixture-post" onReply={()=>{}} onProfilePress={()=>{}}/></QueryClientProvider></React.StrictMode>);
 window.mountScreen=kind=>root.render(<React.StrictMode><QueryClientProvider client={client}>{kind==='comments'?<CommentsScreen/>:<CommentRepliesScreen/>}</QueryClientProvider></React.StrictMode>);
 window.mount(undefined,true);`}});
 const tw=path.dirname(require.resolve('tailwindcss/package.json'));
 const source=['ui/comment-gif.web.tsx','ui/comment-composer.web.tsx','comments.web.tsx','comment-replies.web.tsx'].map(file=>fs.readFileSync(path.join(root,'packages/app/features/comments',file),'utf8')).join('\n');
 const compiler=await compile(fs.readFileSync(path.join(tw,'theme.css'),'utf8')+'\n'+fs.readFileSync(path.join(tw,'preflight.css'),'utf8')+'\n@tailwind utilities;');
 fs.writeFileSync(path.join(dir,'style.css'),compiler.build(source.match(/[a-zA-Z0-9_!@#%./:[\](),+*=&<>-]+/g)||[])+'body{background:#02030a;color:white;font-family:Arial;margin:0}');

 if(process.argv.includes('--dom')) {
  const {Window}=await import(require('node:url').pathToFileURL(require.resolve('happy-dom')).href);const w=new Window({url:'https://fixture.invalid'});w.document.body.innerHTML='<div id="root"></div>';
  w.HTMLElement.prototype.scrollIntoView=function(){};
  const matchMedia=w.matchMedia.bind(w),motionListeners=new Set();let reducedMotion=false;w.matchMedia=query=>query==='(prefers-reduced-motion: reduce)'?{get matches(){return reducedMotion},addEventListener:(_event,cb)=>motionListeners.add(cb),removeEventListener:(_event,cb)=>motionListeners.delete(cb)}:matchMedia(query);w.setReducedMotion=value=>{reducedMotion=value;for(const notify of motionListeners)notify()};
  const wait=async check=>{for(let i=0;i<300;i++){if(check())return;await new Promise(r=>setTimeout(r,10));}throw Error('DOM did not settle: '+w.document.body.textContent);};
  const typeSearch=value=>{const input=w.document.querySelector('[aria-label="Search GIFs"]');Object.getOwnPropertyDescriptor(w.HTMLInputElement.prototype,'value').set.call(input,value);input.dispatchEvent(new w.Event('input',{bubbles:true}));};
  const button=text=>[...w.document.querySelectorAll('button')].find(el=>el.textContent===text);
  try {
   Object.assign(global,{window:w,document:w.document,Element:w.Element,HTMLInputElement:w.HTMLInputElement,HTMLElement:w.HTMLElement,ShadowRoot:w.ShadowRoot,requestAnimationFrame:w.requestAnimationFrame.bind(w),cancelAnimationFrame:w.cancelAnimationFrame.bind(w)});require('node:vm').runInThisContext(fs.readFileSync(path.join(dir,'app.js'),'utf8'));await wait(()=>button('Comment'));button('Comment').click();await wait(()=>w.document.querySelector('textarea'));
   w.draft.getState().setText('Offline draft');await wait(()=>w.document.querySelector('textarea')?.value==='Offline draft');
   w.deferGate=true;w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>w.finishGate);button('Close').click();await wait(()=>!w.document.querySelector('textarea'));w.finishGate();assert.equal(w.calls.length,0,'closed deferred draft must not send');
   w.deferGate=false;button('Comment').click();await wait(()=>w.document.querySelector('textarea'));w.draft.getState().setText('Retry me');await wait(()=>w.document.querySelector('textarea').value==='Retry me');w.fail=true;
   w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>w.calls.length===1&&w.release);w.release();await wait(()=>w.document.querySelector('[role=alert]'));assert.equal(w.draft.getState().text,'Retry me');
   w.fail=false;w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>w.calls.length===2);w.release();await wait(()=>!w.document.querySelector('textarea'));assert.equal(w.draft.getState().text,'');
   // Binding the same context is idempotent, including StrictMode effect replay.
   w.draft.getState().openComposer({commentId:'17',username:'deviantevents'});w.draft.getState().setText('Keep across remount');const revision=w.draft.getState().revision;w.draft.getState().bindContext('fixture-author:fixture-post:comments');assert.equal(w.draft.getState().revision,revision);assert.equal(w.draft.getState().text,'Keep across remount');
   w.draft.getState().bindContext('another-post:comments');assert.equal(w.draft.getState().text,'');assert.equal(w.draft.getState().replyTo,null);
   w.draft.getState().reset();w.draft.getState().bindContext('fixture-author:fixture-post:comments');w.mount(undefined,true);await wait(()=>button('Comment'));button('Comment').click();await wait(()=>w.document.querySelector('textarea'));
   w.document.querySelector('[aria-label="Add GIF"]').click();await wait(()=>w.document.querySelector('[aria-label="Choose Wave"]'));button('Load more GIFs').click();await wait(()=>w.document.querySelector('[aria-label="Choose Dance"]'));assert.equal(w.document.querySelectorAll('[aria-label="Choose Wave"]').length,1);
   w.document.querySelector('[aria-label="Choose Wave"]').click();await wait(()=>button('Remove GIF'));assert.equal(w.draft.getState().attachment.id,'wave');button('Remove GIF').click();await wait(()=>!w.draft.getState().attachment);
   w.draft.getState().setAttachment(w.fixtureGif);await wait(()=>button('Remove GIF'));w.deferGate=true;w.finishGate=undefined;w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>w.finishGate);const beforeGif=w.calls.length;w.draft.getState().setAttachment(null);w.finishGate();assert.equal(w.calls.length,beforeGif,'changing GIF invalidates deferred send');await wait(()=>!button('Remove GIF'));
   w.deferGate=false;w.draft.getState().setAttachment(w.fixtureGif);await wait(()=>button('Remove GIF'));w.fail=true;w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>w.calls.length===beforeGif+1);w.release();await wait(()=>w.document.querySelector('[role=alert]'));assert.equal(w.draft.getState().attachment.id,'saved');w.fail=false;w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>w.calls.length===beforeGif+2);assert.equal(w.calls.at(-1).text,'');assert.equal(w.calls.at(-1).attachment.id,'saved');w.release();await wait(()=>!w.document.querySelector('textarea'));assert.equal(w.draft.getState().attachment,null);
   button('Comment').click();await wait(()=>w.document.querySelector('textarea'));w.document.querySelector('[aria-label="Add GIF"]').click();await wait(()=>w.document.querySelector('[aria-label="Choose Wave"]'));
   typeSearch('slow');await wait(()=>w.releaseSlowGif);typeSearch('fresh');await wait(()=>w.document.querySelector('[aria-label="Choose Search wave"]'));w.releaseSlowGif();await new Promise(resolve=>setTimeout(resolve,20));assert.equal(w.document.querySelector('[aria-label="Choose Stale result"]'),null);
   // Enter in search must not submit the enclosing comment form.
   w.draft.getState().setText('Retain while searching');await wait(()=>w.document.querySelector('textarea').value==='Retain while searching');const noSearchSend=w.calls.length;w.document.querySelector('[aria-label="Search GIFs"]').dispatchEvent(new w.KeyboardEvent('keydown',{key:'Enter',bubbles:true,cancelable:true}));assert.equal(w.calls.length,noSearchSend);
   typeSearch('empty');await wait(()=>w.document.body.textContent.includes('No GIFs found.'));typeSearch('error');await wait(()=>button('Retry'));w.gifRecovered=true;button('Retry').click();await wait(()=>w.document.querySelector('[aria-label="Choose Search wave"]'));
   typeSearch('fallback');await wait(()=>w.document.querySelector('[aria-label="Choose Noto smile"]'));assert(w.document.body.textContent.includes('Showing Google Noto Emoji.'));w.document.querySelector('[aria-label="Choose Noto smile"]').click();await wait(()=>w.draft.getState().attachment?.provider==='noto');
   const textGifCalls=w.calls.length;w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>w.calls.length===textGifCalls+1);assert.equal(w.calls.at(-1).text,'Retain while searching');assert.equal(w.calls.at(-1).attachment.provider,'noto');w.release();await wait(()=>!w.document.querySelector('textarea'));
   button('Comment').click();await wait(()=>w.document.querySelector('textarea'));w.draft.getState().setAttachment(w.fixtureGif);await wait(()=>button('Remove GIF'));w.deferGate=true;w.finishGate=undefined;w.document.querySelector('form').dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await wait(()=>w.finishGate);const accountCalls=w.calls.length;w.auth.setState({user:{id:'other-author',username:'other'}});w.finishGate();assert.equal(w.calls.length,accountCalls,'account switch prevents old actor submission');await wait(()=>w.draft.getState().context==='other-author:fixture-post:comments');assert.equal(w.draft.getState().attachment,null);assert.equal(w.draft.getState().text,'');w.deferGate=false;
   w.setReducedMotion(true);w.mountGif();await wait(()=>button('Play GIF: Saved wave'));assert.equal(w.document.querySelector('img[alt="Saved wave"]'),null);button('Play GIF: Saved wave').click();await wait(()=>w.document.querySelector('img[alt="Saved wave"]'));button('Stop GIF').click();await wait(()=>button('Play GIF: Saved wave'));assert.equal(w.document.querySelector('img[alt="Saved wave"]'),null);w.setReducedMotion(false);await wait(()=>w.document.querySelector('img[alt="Saved wave"]'));w.document.querySelector('img[alt="Saved wave"]').dispatchEvent(new w.Event('error'));await wait(()=>w.document.body.textContent.includes('GIF unavailable: Saved wave'));
   console.log('PASS DOM: actual composer, deferred close guard, duplicate submission, failure/retry, context isolation, StrictMode-safe binding, GIF pagination/search/fallback/retry/stale results, GIF-only/text+GIF failure/retry, deferred attachment guards, reduced-motion playback and broken-image fallback');
  } finally {w.cleanup?.();await w.happyDOM.abort();w.close();}
  process.exit(0);
 }
 server=http.createServer((req,res)=>{const file=req.url==='/app.js'?'app.js':req.url==='/style.css'?'style.css':null;if(file){res.setHeader('Content-Type',file.endsWith('js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(dir,file)));}else res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const engine=process.env.COMMENT_BROWSER==='webkit'?webkit:chromium;
 browser=await engine.launch({headless:true,...(engine===chromium?{...(fs.existsSync('/usr/bin/chromium')?{executablePath:'/usr/bin/chromium'}:{}),args:['--no-sandbox']}: {})});
 for (const width of keyboardBaseline?[393]:[320,360,393,430,1440]) {
  const page=await browser.newPage({viewport:{width,height:852},isMobile:width<=430,hasTouch:width<=430});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/*',route=>new URL(route.request().url()).hostname==='127.0.0.1'?route.continue():route.request().resourceType()==='image'?route.fulfill({contentType:'image/gif',body:gifFixtures[new URL(route.request().url()).pathname.includes('tall')?'tall':new URL(route.request().url()).pathname.includes('wide')?'wide':'normal']}):route.abort());
  await page.goto('http://127.0.0.1:'+server.address().port);
  if(width<=430){await checkVisualViewportKeyboard(page,width,keyboardBaseline);if(keyboardBaseline){assert.deepEqual(errors,[]);await page.close();continue;}}
  await page.locator('#comment-trigger').click();const input=page.getByRole('textbox',{name:'Add a comment',exact:true});await input.waitFor();
  assert.equal(await input.evaluate(el=>el===document.activeElement),true,'composer receives focus');
  const geometry=await page.evaluate(()=>({card:document.querySelector('#comment-card').getBoundingClientRect().bottom,composer:document.querySelector('[aria-label="Comment composer"]').getBoundingClientRect().top,overflow:document.documentElement.scrollWidth>innerWidth}));
  assert(geometry.composer>=geometry.card,'composer never overlaps existing comment actions');assert(!geometry.overflow,'no horizontal overflow');
  assert.equal(await page.getByRole('button',{name:'Post comment',exact:true}).isDisabled(),true);
  await input.fill('   ');assert.equal(await page.getByRole('button',{name:'Post comment',exact:true}).isDisabled(),true);
  await input.fill('First line');await input.press('Shift+Enter');await input.type('Second line');assert.equal(await input.inputValue(),'First line\nSecond line');
  await input.press('Escape');await input.waitFor({state:'detached'});await page.waitForFunction(()=>document.activeElement===document.querySelector('#comment-trigger'));
  await page.getByText('Reply',{exact:true}).click();const reply=page.getByRole('textbox',{name:'Reply to deviantevents',exact:true});await reply.waitFor();
  await page.screenshot({path:path.join(dir,`reply-${width}.png`),fullPage:true});
  await reply.fill('Keep my draft');await page.getByRole('button',{name:'Cancel reply',exact:true}).click();await input.waitFor();assert.equal(await input.inputValue(),'Keep my draft');
  await input.evaluate(el=>el.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',bubbles:true,isComposing:true})));assert.equal(await page.evaluate(()=>calls.length),0,'IME does not send');
  await page.evaluate(()=>window.blocked=true);await input.press('Enter');assert.equal(await page.evaluate(()=>calls.length),0);assert.equal(await input.inputValue(),'Keep my draft');await page.evaluate(()=>window.blocked=false);
  await page.getByText('Reply',{exact:true}).click();await reply.waitFor();await page.evaluate(()=>window.fail=true);await reply.press('Enter');
  await page.getByRole('status').waitFor();assert.equal(await page.getByRole('button',{name:'Post reply',exact:true}).isDisabled(),true);assert.equal(await page.evaluate(()=>calls.length),1);
  await page.evaluate(()=>release());await page.getByRole('alert').waitFor();assert.equal(await reply.inputValue(),'Keep my draft');
  await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'Post reply',exact:true}).click();await page.waitForFunction(()=>calls.length===2);await page.evaluate(()=>release());await reply.waitFor({state:'detached'});
  assert.deepEqual(await page.evaluate(()=>calls[1]),{post:'fixture-post',text:'Keep my draft',parent:'17',replyToCommentId:'17',authorUsername:'viewer',authorId:'fixture-author'});
  await page.evaluate(()=>mount('root-thread'));await page.getByRole('button',{name:'Add a reply…',exact:true}).click();const threadInput=page.getByRole('textbox',{name:'Add a reply',exact:true});await threadInput.fill('Thread reply');await threadInput.press('Enter');await page.waitForFunction(()=>calls.length===3);assert.equal(await page.evaluate(()=>calls[2].parent),'root-thread');assert.equal(await page.evaluate(()=>calls[2].replyToCommentId),'root-thread');await page.evaluate(()=>release());await threadInput.waitFor({state:'detached'});
  // A short available viewport simulates keyboard occlusion; no physical keyboard
  // or actual tab bar is mounted. Only verify the app's configured CSS clearance.
  await page.evaluate(()=>document.documentElement.style.setProperty('--dvnt-tabbar-clearance','80px'));await page.setViewportSize({width,height:400});await page.getByRole('button',{name:'Add a reply…',exact:true}).click();await threadInput.waitFor();await threadInput.scrollIntoViewIfNeeded();
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
  await page.screenshot({path:path.join(dir,`keyboard-${width}.png`),fullPage:true});
  assert.equal(await page.locator('[aria-label="Comment composer"]').evaluate(el=>parseFloat(getComputedStyle(el).paddingBottom)>=96),true,'configured tab-bar CSS clearance reserves space (not a mounted tab bar)' );
  for(const screen of ['comments','replies']){await page.evaluate(kind=>mountScreen(kind),screen);await page.getByText('Reply',{exact:true}).first().click();await page.getByRole('textbox',{name:'Reply to deviantevents',exact:true}).waitFor();const bottom=await page.getByText('Reply',{exact:true}).first().evaluate(el=>el.getBoundingClientRect().bottom);const top=await page.locator('[aria-label="Comment composer"]').evaluate(el=>el.getBoundingClientRect().top);assert(top>=bottom,'full-screen composer stays below reply controls');await page.screenshot({path:path.join(dir,`${screen}-${width}.png`),fullPage:true});}
  // Actual GIF picker, deterministic provider boundary, no external network/data writes.
  await page.setViewportSize({width,height:852});await page.evaluate(()=>{draft.getState().reset();mount(undefined,true)});
  await page.locator('#comment-trigger').click();await page.getByRole('button',{name:'Add GIF',exact:true}).click();
  await page.getByRole('button',{name:'Choose Wave',exact:true}).waitFor();
  await page.getByRole('button',{name:'Load more GIFs',exact:true}).click();await page.getByRole('button',{name:'Choose Dance',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Choose Wave',exact:true}).count(),1,'pagination deduplicates GIFs');
  const search=page.getByRole('textbox',{name:'Search GIFs',exact:true});
  await search.fill('slow');await page.waitForFunction(()=>!!window.releaseSlowGif);await search.fill('fresh');await page.getByRole('button',{name:'Choose Search wave',exact:true}).waitFor();await page.evaluate(()=>releaseSlowGif());assert.equal(await page.getByRole('button',{name:'Choose Stale result',exact:true}).count(),0,'stale provider response cannot replace fresh results');
  await search.fill('empty');await page.getByText('No GIFs found. Try another search.',{exact:true}).waitFor();
  await search.fill('error');await page.getByText('GIFs could not load.',{exact:false}).waitFor();await page.evaluate(()=>window.gifRecovered=true);await page.getByRole('button',{name:'Retry',exact:true}).click();await page.getByRole('button',{name:'Choose Search wave',exact:true}).waitFor();
  await search.fill('fallback');await page.getByRole('button',{name:'Choose Noto smile',exact:true}).waitFor();await page.getByText('GIF search unavailable. Showing Google Noto Emoji.',{exact:true}).waitFor();await page.getByRole('button',{name:'Choose Noto smile',exact:true}).click();assert.equal(await page.evaluate(()=>draft.getState().attachment.provider),'noto');
  await page.getByRole('button',{name:'Remove GIF',exact:true}).click();assert.equal(await page.getByRole('button',{name:'Post comment',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Add GIF',exact:true}).click();await page.getByRole('button',{name:'Choose Wave',exact:true}).click();await page.getByRole('img',{name:'Wave',exact:true}).waitFor();
  // Deferred verification cannot send a replaced GIF or changed reply target.
  await page.evaluate(()=>{window.deferGate=true;window.finishGate=undefined});await page.getByRole('button',{name:'Post comment',exact:true}).click();await page.waitForFunction(()=>!!window.finishGate);const before=await page.evaluate(()=>calls.length);
  await page.getByRole('button',{name:'Remove GIF',exact:true}).click();await page.evaluate(()=>finishGate());assert.equal(await page.evaluate(()=>calls.length),before);
  await page.evaluate(()=>draft.getState().setAttachment(window.fixtureGif));await page.getByRole('button',{name:'Post comment',exact:true}).click();await page.evaluate(()=>{draft.getState().setReplyTo({commentId:'18',username:'another'});finishGate()});assert.equal(await page.evaluate(()=>calls.length),before);
  await page.evaluate(()=>{window.deferGate=false;draft.getState().setReplyTo(null);window.fail=true});await page.getByRole('button',{name:'Post comment',exact:true}).click();await page.waitForFunction(n=>calls.length===n+1,before);await page.evaluate(()=>release());await page.getByRole('alert').waitFor();assert.equal(await page.evaluate(()=>draft.getState().attachment.id),'saved');
  await page.evaluate(()=>window.fail=false);await page.getByRole('button',{name:'Post comment',exact:true}).click();await page.waitForFunction(n=>calls.length===n+2,before);assert.equal(await page.evaluate(()=>calls.at(-1).text),'');assert.equal(await page.evaluate(()=>calls.at(-1).attachment.id),'saved');await page.evaluate(()=>release());await input.waitFor({state:'detached'});
  await page.locator('#comment-trigger').click();await input.fill('Text and GIF');await page.evaluate(()=>draft.getState().setAttachment(window.fixtureGif));await page.getByRole('button',{name:'Post comment',exact:true}).click();await page.waitForFunction(n=>calls.length===n+3,before);assert.equal(await page.evaluate(()=>calls.at(-1).text),'Text and GIF');assert.equal(await page.evaluate(()=>calls.at(-1).attachment.id),'saved');await page.evaluate(()=>release());await input.waitFor({state:'detached'});
  await page.locator('#comment-trigger').click();await page.evaluate(()=>{draft.getState().setAttachment(window.fixtureGif);window.deferGate=true;window.finishGate=undefined});await page.getByRole('button',{name:'Post comment',exact:true}).click();await page.waitForFunction(()=>!!window.finishGate);const accountCalls=await page.evaluate(()=>calls.length);await page.evaluate(()=>{auth.setState({user:{id:'other-author',username:'other'}});finishGate()});assert.equal(await page.evaluate(()=>calls.length),accountCalls);await page.waitForFunction(()=>draft.getState().context==='other-author:fixture-post:comments');assert.equal(await page.evaluate(()=>draft.getState().attachment),null);await page.evaluate(()=>window.deferGate=false);
  for(const screen of ['comments','replies']){await page.evaluate(kind=>mountScreen(kind),screen);await page.getByRole('img',{name:'Saved wave',exact:true}).first().waitFor();await page.screenshot({path:path.join(dir,`gif-${screen}-${width}.png`),fullPage:true});}
  await page.emulateMedia({reducedMotion:'reduce'});await page.getByRole('button',{name:'Play GIF: Saved wave',exact:true}).first().waitFor();assert.equal(await page.getByRole('img',{name:'Saved wave',exact:true}).count(),0,'reduced motion never auto-loads the animation');await page.getByRole('button',{name:'Play GIF: Saved wave',exact:true}).first().click();await page.getByRole('img',{name:'Saved wave',exact:true}).first().waitFor();await page.getByRole('button',{name:'Stop GIF',exact:true}).first().click();await page.getByRole('button',{name:'Play GIF: Saved wave',exact:true}).first().waitFor();
  await page.emulateMedia({reducedMotion:'no-preference'});await page.getByRole('img',{name:'Saved wave',exact:true}).first().dispatchEvent('error');await page.getByText('GIF unavailable: Saved wave',{exact:true}).first().waitFor();
  if(width<=430) await checkMobileGifQuality(page,width);
  assert.deepEqual(errors,[]);await page.close();
 }
 if(keyboardBaseline){console.log('PASS negative control: merged a1946d10 clips plain textarea and GIF picker with visualViewport-only keyboard events. Evidence: '+dir);return;}
 console.log('PASS: visualViewport-only keyboard resize/pan/recovery/cleanup and actual composer/rows at 320, 360, 393, 430 and 1440px; non-overlap, focus/close, cancel reply, whitespace, multiline, IME, admission, pending, failure/retry, thread payloads, keyboard-sized viewport, GIF picker/search/pagination/fallback/stale results, GIF-only/text+GIF, revision-safe drafts, saved rendering, visible two-frame GIFs, scrollable gallery, loading/error screenshots, long captions/targets, tall/wide media, 44px composer/picker controls, reduced motion, short/landscape viewports and configured CSS clearance. Evidence: '+dir);
 } finally {if(browser)await browser.close();if(server)await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);process.exitCode=1});
