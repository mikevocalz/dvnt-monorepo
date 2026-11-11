/** Chromium production WEB navigation rows/chrome and scroll hook integration.
 * Feed content, app preferences, router and API/auth boundaries are synthetic.
 * Real RN-web/Tailwind layout, not a deployed Next/backend end-to-end test.
 * --build-only compiles JS/CSS without launching Chromium.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {build} = require('esbuild');
const {compile} = require('tailwindcss');
const root = path.resolve(__dirname,'..');
const app = path.join(root,'packages/app');
const fixtures = {
 '@dvnt/app/lib/media/use-post-preview-lease': `export const usePostPreviewLease=(_id,fallback)=>fallback;`,
 '@dvnt/app/features/settings/follow-requests-setting.web': `export const FollowRequestsSetting=()=>null;`,
 '@dvnt/app/features/settings/follow-requests-setting': `export const FollowRequestsSetting=()=>null;`,
 // Decorative gradient only: real RN-web View preserves the flex layout.
 'expo-linear-gradient': `import {View} from 'react-native';export const LinearGradient=({children,style})=><View style={style}>{children}</View>;`,
 'expo-router': `export const useRouter=()=>({push:path=>window.nav.navigate(path)});`,
 'solito/navigation': `export const usePathname=()=>window.nav.path;export const useRouter=()=>({push:path=>window.nav.navigate(path)});`,
 '@dvnt/app/lib/stores/app-store': `import {create} from 'zustand';export const useAppStore=create(set=>({nsfwEnabled:true,setNsfwEnabled:nsfwEnabled=>set({nsfwEnabled})}));`,
 '@dvnt/app/lib/stores/auth-store': `export const useAuthStore=s=>s({user:{id:'fixture',username:'viewer'}});`,
 '@dvnt/app/lib/hooks/use-messages': `export const useUnreadMessageCount=()=>({data:0});`,
 '@dvnt/app/lib/hooks/use-notifications-query': `export const useBadges=()=>({data:{unread:0}});`,
 '@dvnt/app/components/ui/html': `import {View} from 'react-native';export const Header=View;`,
 '@dvnt/app/components/logo': `export default ()=> <span>DVNT</span>;`,
 '@dvnt/app/lib/hooks/use-activities-query': `export const useActivitiesQuery=()=>({});export const useLikedActivitiesQuery=()=>({});export const activityKeys={};`,
 '@tanstack/react-virtual': `export const useVirtualizer=()=>({});`,
 '@dvnt/app/lib/stores/activity-store': `export const useActivityStore=()=>({});`,
 '@dvnt/app/lib/hooks/use-follow': `export const useFollow=()=>({});`,
 '@dvnt/app/lib/hooks/use-bootstrap-notifications': `export const useBootstrapNotifications=()=>{};`,
 '@dvnt/app/features/sneaky-lynk/ui/web/CohostInvites': `export const PendingCohostInvites=()=>null;`,
 '@dvnt/app/lib/api/notifications': `export const notificationsApiClient={};`,
 '@dvnt/app/lib/stores/ui-store': `export const useUIStore=()=>({});`,
 '@dvnt/app/lib/api/users': `export const usersApi={};`,
 '@dvnt/app/lib/api/events': `export const eventsApi={};`,
 '@dvnt/app/lib/api/privileged': `export const acceptCoOrganizerInvite=()=>{};export const declineCoOrganizerInvite=()=>{};`,
 '@dvnt/app/lib/events/event-lynk': `export const roomInviteActivityText=()=>'';`,
 '@dvnt/app/lib/activity/mark-activity-read': `export const markActivityRead=()=>{};export const markAllActivityRead=()=>{};`,
};
const source = `
import React,{useRef,useState,useEffect} from 'react';import {createRoot} from 'react-dom/client';import {flushSync} from 'react-dom';
import {WebAppHeader} from '@dvnt/app/components/web-app-header.web';
import {WebTabBar} from '@dvnt/app/components/web-tab-bar.web';
import {TextPostSurface} from '@dvnt/app/features/post/ui/TextPostSurface';
import {ActivityRow,webRouteForActivity} from '@dvnt/app/features/activity/activity.web';
import {useAppStore} from '@dvnt/app/lib/stores/app-store';
import {useFeedScrollStore} from '@dvnt/app/lib/stores/feed-scroll-store';
import {useScrollRestoration} from '@dvnt/app/lib/hooks/use-scroll-restoration.web';
const postText='FIRST_LINE A long text-only post should remain left aligned and readable while flowing naturally over multiple lines on both phone and desktop screens. '+ 'More words keep the surface growing vertically without cutting off the complete text. '.repeat(4)+'\\nSECOND_LINE Explicit line breaks must be preserved.\\n'+ 'UnbrokenWord'.repeat(14)+'\\nFINAL_LINE End of the full post.';
window.nav={postText,path:'/feed',routes:[],profiles:[],useAppStore,useFeedScrollStore};
function Feed(){const ref=useRef(null);const trigger=useFeedScrollStore(s=>s.scrollToTopTrigger);const consumed=useFeedScrollStore(s=>s.consumedTrigger);const reset=trigger>consumed;
 useScrollRestoration(ref,'feed',true,false,reset,trigger);useEffect(()=>{if(reset)useFeedScrollStore.getState().consumeScrollToTop(trigger)},[reset,trigger]);
 return <div id="feed-scroller" ref={ref} style={{height:260,overflowY:'auto'}}><div id="feed-content" style={{height:3000}}>Synthetic feed content</div></div>;
}
function App(){const [pathname,setPath]=useState('/feed');const [activity,setActivity]=useState(null);const [showText,setShowText]=useState(false);window.nav.renderTextPosts=()=>flushSync(()=>setShowText(true));window.nav.renderActivity=a=>flushSync(()=>setActivity(a));window.nav.path=pathname;window.nav.navigate=p=>{window.nav.routes.push(p);flushSync(()=>setPath(p))};
 return <><WebAppHeader/><main style={{paddingTop:90,paddingBottom:110,maxWidth:640,margin:'auto'}}>{pathname==='/feed'?<Feed/>:<p>Other route fixture</p>}{activity&&<section id="activity"><ActivityRow activity={activity} isFollowed={false} isFollowPending={false} onActivityPress={a=>window.nav.routes.push(webRouteForActivity(a))} onUserPress={u=>window.nav.profiles.push(u)} onPostPress={()=>{}} onFollowBack={()=>{}}/></section>}{showText&&['feed','detail'].map(variant=><section key={variant} id={'text-post-'+variant} style={{padding:12}}><TextPostSurface text={postText} variant={variant}/></section>)}</main><WebTabBar/></>;
}createRoot(document.getElementById('root')).render(<App/>);
`;
(async()=>{
 const bundle=await build({stdin:{contents:source,resolveDir:root,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',tsconfigRaw:{},
 nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),resolveExtensions:['.web.ts','.web.tsx','.ts','.tsx','.js','.json'],alias:{'react-native':'react-native-web','@dvnt/app':app},
 define:{'process.env.NODE_ENV':'"test"','process.env.NEXT_PUBLIC_BUNNY_CDN_URL':'""','process.env.EXPO_PUBLIC_BUNNY_CDN_URL':'""',__DEV__:'true'},
 plugins:[{name:'synthetic-boundaries',setup(b){b.onResolve({filter:/.*/},a=>{let key=a.path;if(key.startsWith('.'))key='@dvnt/app/'+path.relative(app,path.resolve(a.resolveDir,key)).replace(/\\/g,'/');if(fixtures[key])return {path:key,namespace:'fixture'};});b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixtures[a.path],loader:'tsx',resolveDir:root}));}}]});
 const tw=path.dirname(require.resolve('tailwindcss/package.json'));
 const activitySource=fs.readFileSync(path.join(app,'features/activity/activity.web.tsx'),'utf8');
 const compiler=await compile(fs.readFileSync(path.join(tw,'theme.css'),'utf8')+'\n'+fs.readFileSync(path.join(tw,'preflight.css'),'utf8')+'\n@tailwind utilities;');
 const css=compiler.build(activitySource.match(/[a-zA-Z0-9_!@#%./:[\](),+*=&<>-]+/g)||[]);
 if(process.argv.includes('--build-only')){console.log('PASS weekly navigation browser JS/CSS build; browser assertions NOT executed');return;}
 const {chromium}=require('playwright');const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
 try{for(const width of [390,1280]){
 const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
 // A synthetic origin provides real sessionStorage. No live network escapes.
 await page.route('**/*',route=>route.request().isNavigationRequest()?route.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}):route.abort());
 await page.goto('https://weekly-fixture.invalid/feed');await page.addStyleTag({content:css});await page.addScriptTag({content:bundle.outputFiles[0].text});
 const home=page.getByRole('button',{name:'Home',exact:true});const logo=page.getByRole('button',{name:'Sweet feed, back to top',exact:true});await home.waitFor();
 const scroll=()=>page.evaluate(()=>{document.getElementById('feed-scroller').scrollTop=900;sessionStorage.setItem('dvnt:scroll:feed','900');});
 await scroll();await home.dblclick();await page.waitForFunction(()=>document.getElementById('feed-scroller').scrollTop===0);assert.equal(await page.evaluate(()=>nav.useFeedScrollStore.getState().scrollToTopTrigger),2);assert.deepEqual(await page.evaluate(()=>nav.routes),[]);
 for(let i=0;i<2;i++){await scroll();await page.evaluate(()=>nav.useAppStore.setState({nsfwEnabled:true}));await logo.click();await page.waitForFunction(()=>document.getElementById('feed-scroller').scrollTop===0);assert.equal(await page.evaluate(()=>nav.useAppStore.getState().nsfwEnabled),false);}
 // Leaving and returning restores a stored position; logo from another route
 // consumes a fresh reset instead, without a delayed old restoration winning.
 await scroll();await page.evaluate(()=>nav.navigate('/notifications'));await page.evaluate(()=>nav.navigate('/feed'));await page.waitForFunction(()=>document.getElementById('feed-scroller').scrollTop===900);
 await page.evaluate(()=>{nav.navigate('/notifications');nav.useAppStore.setState({nsfwEnabled:true});});await logo.click();await page.waitForFunction(()=>document.getElementById('feed-scroller')?.scrollTop===0);assert.equal(await page.evaluate(()=>nav.useAppStore.getState().nsfwEnabled),false);
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));assert.equal(await page.evaluate(()=>sessionStorage.getItem('dvnt:scroll:feed')),'0');
 await page.evaluate(()=>nav.navigate('/notifications'));
 const cases=[{type:'like',postId:'post-42',expected:'/feed/post/post-42'},{type:'comment',entityType:'post',entityId:'post-43',expected:'/feed/post/post-43'},{type:'event_broadcast',entityType:'event',entityId:'90',expected:'/feed/events/90',payload:{body:'A long venue update wraps naturally across several lines on a small phone. Please check the new venue before travelling to the event this evening.'}},{type:'ticket_comped',entityType:'event',entityId:'90',payload:{ticket_id:'00000000-0000-4000-8000-000000000042'},expected:'/feed/ticket/00000000-0000-4000-8000-000000000042'},{type:'ticket_transfer_initiated',expected:'/feed/events/my-tickets'}];
 for(const item of cases){await page.evaluate(a=>nav.renderActivity({...a,id:'fixture',user:{username:'actor',avatar:''},timeAgo:'now',isRead:false}),item);const row=page.locator('#activity > [role=button]');assert.equal(await row.getByRole('button',{name:'actor',exact:true}).count(),2,'avatar and sender name are distinct actor controls');
 for(let repeat=0;repeat<2;repeat++){const before=await page.evaluate(()=>nav.routes.length);await row.click({position:{x:200,y:20}});assert.equal(await page.evaluate(()=>nav.routes.length),before+1);assert.equal(await page.evaluate(()=>nav.routes.at(-1)),item.expected);
 for(const actor of [row.getByRole('button',{name:'actor',exact:true}).first(),row.getByRole('button',{name:'actor',exact:true}).last()]){const before=await page.evaluate(()=>nav.routes.length);await actor.click();assert.equal(await page.evaluate(()=>nav.profiles.at(-1)),'actor');assert.equal(await page.evaluate(()=>nav.routes.length),before);}}
 for(const key of ['Enter','Space']){const before=await page.evaluate(()=>nav.routes.length);await row.focus();await page.keyboard.press(key);assert.equal(await page.evaluate(()=>nav.routes.length),before+1);assert.equal(await page.evaluate(()=>nav.routes.at(-1)),item.expected);}
 if(item.type==='event_broadcast'){const layout=await row.locator('p').nth(1).evaluate(el=>({align:getComputedStyle(el).textAlign,height:el.getBoundingClientRect().height,line:parseFloat(getComputedStyle(el).lineHeight),width:el.clientWidth,scroll:el.scrollWidth}));assert.ok(['start','left'].includes(layout.align));assert.ok(layout.height>layout.line,'broadcast text must wrap');assert.ok(layout.scroll<=layout.width+1,'wrapped text must not overflow');}
 }
 // Actual shared production surface + HashtagText + font fitting through RN
 // Web. Only its decorative gradient and logo are fixtures, never the text.
 await page.evaluate(()=>nav.renderTextPosts());
 for(const variant of ['feed','detail']){
 const surface=page.locator('#text-post-'+variant);await surface.scrollIntoViewIfNeeded();
 await page.waitForFunction(id=>Array.from(document.querySelectorAll('#'+id+' [dir="auto"]')).some(el=>el.textContent===nav.postText), 'text-post-'+variant);
 // RN-web onLayout feeds production font fitting after its first render.
 await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 const geometry=await surface.evaluate(container=>{
   const text=Array.from(container.querySelectorAll('[dir="auto"]')).find(el=>el.textContent===nav.postText);
   const style=getComputedStyle(text),box=text.getBoundingClientRect();
   const walker=document.createTreeWalker(text,NodeFilter.SHOW_TEXT);const rects=[];let node;let second;let unbrokenLines=0;
   while(node=walker.nextNode()){
     // CSS pre-wrap can hang trailing spaces beyond a line box. Inspect actual
     // word fragments, not those non-painted spaces, for clipping/overflow.
     for(const match of node.textContent.matchAll(/\S+/g)){
       const range=document.createRange();range.setStart(node,match.index);range.setEnd(node,match.index+match[0].length);
       const fragments=Array.from(range.getClientRects()).filter(r=>r.width>0);rects.push(...fragments);
       if(match[0].startsWith('UnbrokenWord'))unbrokenLines=fragments.length;
     }
     const index=node.textContent.indexOf('SECOND_LINE');if(index>=0){const range=document.createRange();range.setStart(node,index);range.setEnd(node,index+'SECOND_LINE'.length);second=range.getBoundingClientRect();}
   }
   return {text:text.textContent,align:style.textAlign,width:text.clientWidth,scroll:text.scrollWidth,height:box.height,line:parseFloat(style.lineHeight),lines:new Set(rects.map(r=>r.y)).size,unbrokenLines,left:box.left,second:second&&{x:second.x,y:second.y},firstY:rects[0]?.y,bodyOverflow:document.documentElement.scrollWidth>innerWidth,minLeft:Math.min(...rects.map(r=>r.left)),maxRight:Math.max(...rects.map(r=>r.right)),right:box.right};
 });
 assert.equal(geometry.text,await page.evaluate(()=>nav.postText),'full text is not truncated');
 assert.equal(geometry.align,'left');assert.ok(geometry.lines>3&&geometry.height>geometry.line*3,'long text grows over multiple lines');
 assert.ok(geometry.second&&geometry.second.y>geometry.firstY,'explicit newline places next paragraph on a later line');
 assert.ok(Math.abs(geometry.second.x-geometry.left)<=2,'explicit new paragraph starts at the left edge');
 assert.ok(geometry.unbrokenLines>1,'long unbroken word must wrap at '+width+'px '+variant+': '+JSON.stringify(geometry));
 assert.ok(geometry.scroll<=geometry.width+1&&geometry.maxRight<=geometry.right+1&&geometry.minLeft>=geometry.left-1,'text glyphs and long unbroken words stay within surface at '+width+'px '+variant+': '+JSON.stringify(geometry));
 assert.equal(geometry.bodyOverflow,false,'text surface never widens viewport');
 }
 assert.deepEqual(errors,[]);await page.close();console.log('PASS '+width+'px Chromium production Home repeated reset, logo Sweet/reset/route, ordinary restoration, Activity target vs actor click/keyboard separation, left-aligned wrapped broadcast text, and actual TextPostSurface feed/detail long/multiline/unbroken text layout. Synthetic feed/router/API boundaries.');
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
