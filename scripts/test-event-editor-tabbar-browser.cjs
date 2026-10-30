#!/usr/bin/env node
// Mount the complete production create/edit screens and navigation shell. Only
// network/auth/storage boundaries are stubbed: no production account or writes.
// Browser viewport/scroll geometry and editor CSS/layout are real.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { build } = require('esbuild');
const { compile } = require('tailwindcss');
const { chromium, webkit } = require('playwright');
const root = path.resolve(__dirname, '..');
const dir = process.env.TABBAR_EVIDENCE_DIR || fs.mkdtempSync(path.join(os.tmpdir(), 'dvnt-editor-tabbar-'));
fs.mkdirSync(dir, { recursive: true });
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
function options(file) {
  return [...read(file).matchAll(/export const [A-Z_]+[^=]*= \[[\s\S]*?\n\];/g)].map(m => m[0]).join('\n');
}
const mocks = {
    // This fixture covers layout; unread data/lifecycle is exercised separately.
    '@dvnt/app/lib/hooks/use-notifications-query': `export const useBadges=()=>({data:{unread:0,total:0}});`,
    '@dvnt/app/lib/hooks/use-messages': `export const useUnreadMessageCount=()=>({data:0,spamCount:0});`,
  '@dvnt/ui/sticky-save-bar-web': `export {StickySaveBar} from '${root}/packages/ui/src/form/StickySaveBar.web';`,
  '@legendapp/list/react-native': `export const LegendList=()=>null;`,
  '@dvnt/supabase': `export const supabase={};`,
  'solito/navigation': `export const usePathname = () => window.editorFixture?.path || '/feed/events/create'; export const useParams=()=>({id:'fixture-event'}); export const useRouter=()=>({push:path=>window.editorFixture.navigate(path),replace:path=>window.editorFixture.navigate(path),back:()=>history.back()});`,
  '@dvnt/app/lib/stores/auth-store': `const state={user:{id:'fixture-owner',username:'member'},isAuthenticated:true,_hasHydrated:true}; export const useAuthStore=selector=>selector(state); useAuthStore.getState=()=>state; useAuthStore.subscribe=()=>()=>{};`,
  '@dvnt/app/lib/stores/ui-store': `export const useUIStore=selector=>selector({showToast:()=>{}});`,
  '@dvnt/app/lib/mmkv-zustand': `export const mmkvStorage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};`,
  '@dvnt/app/lib/hooks/use-events': `const event={id:'fixture-event',hostId:'fixture-owner',title:'Fixture edit event',startDate:'2026-12-31T20:00:00Z',event_tz:'America/New_York',location:'Test venue',category:'party',price:0,visibility:'public'}; export const useEvent=()=>({data:event,isLoading:false}); export const useCreateEvent=()=>({isPending:false,mutateAsync:async()=>{throw Error('publishing forbidden in layout test')}}); export const useUpdateEvent=useCreateEvent;`,
  '@dvnt/app/lib/hooks/use-verified-gate': `export const useVerifiedGate=()=>()=>{};`,
  '@dvnt/app/lib/hooks/use-places-autocomplete': `export const usePlacesAutocomplete=()=>({predictions:[],isLoading:false,onChangeText:()=>{},onSelectPrediction:()=>{}});`,
  '@dvnt/app/lib/hooks/use-event-media-preupload': `export const useEventMediaPreupload=()=>{};`,
  '@dvnt/app/lib/media/use-event-flyer-preparation.web': `export const useEventFlyerPreparation=()=>({isPreparing:false,isBusy:()=>false,prepare:async()=>null,cancel:()=>{}});`,
  '@dvnt/app/lib/api/ticket-types': `${options('packages/app/lib/api/ticket-types.ts')} export const ticketTypesApi={getByEvent:async()=>[]};`,
  '@dvnt/app/lib/api/addons': `${options('packages/app/lib/api/addons.ts')} ${read('packages/app/lib/api/addons.ts').match(/export const VARIANT_ADDON_TYPES[^;]+;/)[0]} ${read('packages/app/lib/api/addons.ts').match(/export const REDEEMABLE_DEFAULTS[^=]+= \{[\s\S]*?\n\};/)[0]} export const addonsApi={getByEvent:async()=>[]};`,
  '@dvnt/app/lib/api/organizer': `export const organizerApi={getStatus:async()=>({})};`,
  '@dvnt/app/features/sneaky-lynk/api/supabase': `export const sneakyLynkApi={};`,
  '@dvnt/app/lib/server-upload': `export const uploadToServer=()=>{throw Error('upload forbidden')};`,
  '@dvnt/app/lib/api/privileged': `export const inviteEventGuests=()=>{};`,
  '@dvnt/app/lib/api/users': `export const usersApi={searchUsers:async()=>[]};`,
  '@dvnt/app/lib/api/events': `export const eventsApi={};`,
  '@dvnt/app/lib/api/event-drafts': `export const eventDraftsApi={saveCurrent:async()=>({revision:1})};`,
  '@dvnt/app/lib/auth-client': `export const getAuthToken=async()=>{throw Error('network forbidden in layout test')};`,
  '@dvnt/app/lib/auth/identity': `export const getAuthIdFromStore=()=> 'fixture-owner'; export const requireBetterAuthToken=()=> {throw Error('network forbidden')};`,
  '@dvnt/app/lib/stores/event-guest-store': `import {create} from 'zustand'; export const useEventGuestStore=create(()=>({guests:[],results:[],search:'',loading:false,load:async()=>{},reset:()=>{}}));`,
  '@dvnt/ui': `export {FormField} from '${root}/packages/ui/src/form/FormField.web'; export {StickySaveBar} from '${root}/packages/ui/src/form/StickySaveBar.web'; export const useDirtyGuard=()=>{}; export {VenueSearchInput} from '${root}/packages/ui/src/VenueSearchInput';`,
  '@dvnt/app/components/ui/html': `export const Main=props=><main {...props}/>;`,
  '@dvnt/app/components/logo': `export default ()=> <span>DVNT</span>;`,
  './web-top-bar.web': `export const WebTopBar=()=> <header style={{height:56}}>DVNT</header>;`,
};
(async()=>{
  let browser, server, page;
  try {
    await build({bundle:true,jsx:'automatic',tsconfigRaw:{},platform:'browser',format:'iife',outfile:path.join(dir,'app.js'),
      nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),
      alias:{'@dvnt/app':path.join(root,'packages/app'),'react-native':'react-native-web'},
      plugins:[{name:'editor-boundaries',setup(b){b.onResolve({filter:/.*/},args=>{
        const key=mocks[args.path]?args.path:Object.keys(mocks).find(key=>key.startsWith('@dvnt/app/')&&args.path===path.join(root,'packages/app',key.slice('@dvnt/app/'.length)));
        if(key)return {path:key,namespace:'mock'};
      });b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:root}));}}],
      stdin:{resolveDir:root,loader:'tsx',contents:`
        import React,{useState,useEffect} from 'react'; import {createRoot} from 'react-dom/client';
        import {AppShell} from './packages/app/components/app-shell.web';
        import {WebAppShell} from './packages/app/components/web-app-shell.web';
        import {CreateEventScreen} from './packages/app/features/events/event-create.web';
        import {EventEditScreen} from './packages/app/features/events/event-edit.web';
        const fixture=window.editorFixture={path:'/feed/events/create',mounts:0};
        function App(){const [path,setPath]=useState(location.pathname); fixture.path=path;fixture.navigate=path=>{history.pushState({},'',path);setPath(path)};
          useEffect(()=>{const pop=()=>setPath(location.pathname);addEventListener('popstate',pop);return()=>removeEventListener('popstate',pop)},[]);
          useEffect(()=>{fixture.mounts++},[]);
          return <AppShell><WebAppShell>{path.includes('edit-event')?<EventEditScreen/>:path==='/feed/events/create'?<CreateEventScreen/>:<h1>Feed fixture</h1>}</WebAppShell></AppShell>;
        } createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);`}});
    // Compile production Tailwind classes with the production theme/preflight.
    const tw=path.dirname(require.resolve('tailwindcss/package.json'));
    const globals=read('apps/web/src/app/(frontend)/globals.css');
    const plain=globals.slice(globals.indexOf('/* ── Deviant brand tokens'));
    const sources=['packages/app/features/events/event-create.web.tsx','packages/app/features/events/event-edit.web.tsx','packages/app/features/events/create/addons-editor.web.tsx','packages/app/features/events/ui/event-publication-picker.web.tsx','packages/app/features/events/ui/event-zone-picker.web.tsx','packages/app/components/web-app-shell.web.tsx','packages/ui/src/form/StickySaveBar.web.tsx','packages/ui/src/form/FormField.web.tsx'];
    const candidates=sources.flatMap(p=>read(p).match(/[a-zA-Z0-9_!@#%./:[\](),+*=&<>-]+/g)||[]);
    const compiler=await compile(fs.readFileSync(path.join(tw,'theme.css'),'utf8')+'\n'+fs.readFileSync(path.join(tw,'preflight.css'),'utf8')+'\n@tailwind utilities important;\n'+plain);
    fs.writeFileSync(path.join(dir,'style.css'),compiler.build(candidates));
    if (process.argv.includes('--build-only')) { console.log('PASS: production editor fixture and CSS bundle'); return; }
    server=http.createServer((req,res)=>{ const file=req.url==='/app.js'?'app.js':req.url==='/style.css'?'style.css':null;
      if(file){res.setHeader('Content-Type',file.endsWith('js')?'text/javascript':'text/css');res.end(fs.readFileSync(path.join(dir,file)));return;}
      res.setHeader('Content-Type','text/html');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel="stylesheet" href="/style.css"></head><body><div id="root"></div><script src="/app.js"></script></body></html>');});
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    if(process.argv.includes('--serve')) {console.log(`Fixture: http://127.0.0.1:${server.address().port}/feed/events/create`); await new Promise(()=>{});}
    const engine=process.env.TABBAR_BROWSER==='webkit'?webkit:chromium;
    browser=await engine.launch({headless:true,...(engine===chromium?{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH||(fs.existsSync('/usr/bin/chromium')?'/usr/bin/chromium':undefined),args:['--no-sandbox']}: {})});
    page=await browser.newPage({viewport:{width:393,height:852},isMobile:true,deviceScaleFactor:1});
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/feed/events/create`);
    await page.getByRole('heading',{name:'Create event',exact:true}).waitFor();
    const bar=page.locator('[data-dvnt-tab-bar]');
    const nextFrame=()=>page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const pinned=async(label)=>{
      await nextFrame();
      const g=await bar.evaluate(el=>({bottom:el.getBoundingClientRect().bottom,left:el.getBoundingClientRect().left,right:el.getBoundingClientRect().right,expected:visualViewport.offsetTop+visualViewport.height,width:document.documentElement.clientWidth}));
      assert.ok(Math.abs(g.bottom-g.expected)<1, label+': '+JSON.stringify(g));
      assert.equal(g.left,0);assert.equal(g.right,g.width);
    };
    const fits=async(label)=>{
      const overflow=await page.locator('[data-dvnt-event-editor]').evaluate(editor=>{
        const bounds=editor.getBoundingClientRect();
        return [...editor.querySelectorAll('section,input,select,textarea,button')].filter(el=>{
          const r=el.getBoundingClientRect();return r.width>0 && (r.right>bounds.right+1||r.left<bounds.left-1);
        }).map(el=>({tag:el.tagName,text:(el.getAttribute('placeholder')||el.textContent||'').slice(0,60),rect:el.getBoundingClientRect().toJSON()}));
      });
      assert.deepEqual(overflow,[],label+': controls extend outside the editor');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=document.documentElement.clientWidth),true,label+': horizontal document overflow');
    };
    const readable=async()=>{
      const small=await page.locator('[data-dvnt-event-editor] input:not([type="checkbox"]):not([type="radio"]):not([type="file"]),[data-dvnt-event-editor] select,[data-dvnt-event-editor] textarea').evaluateAll(nodes=>nodes.filter(el=>el.getBoundingClientRect().width>0&&parseFloat(getComputedStyle(el).fontSize)<16).map(el=>el.outerHTML.slice(0,180)));
      assert.deepEqual(small,[],'editable mobile controls must not trigger iOS focus zoom');
    };
    await bar.waitFor();await pinned('initial create');await fits('initial create');await readable();
    await page.getByPlaceholder("What's the event called?").fill('Retain this draft');
    const initialMounts=await page.evaluate(()=>window.editorFixture.mounts);
    await page.getByRole('heading',{name:'Tickets',exact:true}).scrollIntoViewIfNeeded();
    await pinned('tickets scroll');
    await page.screenshot({path:path.join(dir,'create-tickets.png')});
    await page.getByLabel('Go public at').fill('2026-12-30T18:00');
    await page.getByRole('button',{name:'Clear',exact:true}).first().click();
    await page.getByRole('button',{name:'Add add-on',exact:true}).click();
    await page.getByPlaceholder('Add-on name (e.g. Coat check, Event tee)').fill('Coat check');
    await page.getByLabel('Sell tickets',{exact:true}).check();
    await page.getByRole('button',{name:'Switch to multiple tiers'}).click();
    await page.getByRole('button',{name:'Price goes up at a date'}).click();
    await page.getByRole('button',{name:'First N tickets cheaper'}).click();
    await page.getByRole('button',{name:'Merch',exact:true}).click();
    await page.getByRole('button',{name:'Add size / color'}).click();
    await page.getByPlaceholder('Size',{exact:true}).fill('XL');
    await page.getByPlaceholder('Color',{exact:true}).fill('Purple');
    await fits('expanded add-on variants and ticket tiers');await readable();
    for(const viewport of [{width:320,height:568},{width:375,height:812},{width:393,height:852},{width:430,height:932},{width:767,height:900},{width:852,height:393},{width:768,height:1024},{width:1024,height:900},{width:1440,height:900},{width:393,height:852}]){
      await page.setViewportSize(viewport);await nextFrame();
      if(viewport.width<768){await bar.waitFor();await pinned('resize '+JSON.stringify(viewport));await readable();}
      else await bar.waitFor({state:'detached'});
      await fits('resize '+JSON.stringify(viewport));
      assert.equal(await page.getByPlaceholder("What's the event called?").inputValue(),'Retain this draft');
      assert.equal(await page.evaluate(()=>window.editorFixture.mounts),initialMounts);
    }
    for(const top of [0,400,1600,3200,99999,0]){
      await page.evaluate(y=>scrollTo(0,y),top);await pinned('document scroll '+top);
    }
    // Deterministic contract for visual viewport divergence. This is NOT an
    // actual iOS keyboard: CI also exercises real zoom below in Chromium.
    await page.evaluate(()=>{
      window.editorFixture.viewportOriginals={};
      for(const key of ['height','offsetTop'])window.editorFixture.viewportOriginals[key]=Object.getOwnPropertyDescriptor(visualViewport,key);
    });
    const setViewportMetrics=metrics=>page.evaluate(metrics=>{for(const [key,value] of Object.entries(metrics))Object.defineProperty(visualViewport,key,{configurable:true,value});visualViewport.dispatchEvent(new Event('resize'));visualViewport.dispatchEvent(new Event('scroll'));},metrics);
    const restoreViewportMetrics=()=>page.evaluate(()=>{for(const [key,value] of Object.entries(window.editorFixture.viewportOriginals)){if(value)Object.defineProperty(visualViewport,key,value);else delete visualViewport[key];}visualViewport.dispatchEvent(new Event('resize'));});
    for(const metrics of [{height:500,offsetTop:0},{height:470,offsetTop:70},{height:852,offsetTop:0},{height:760,offsetTop:0},{height:852,offsetTop:0}]){
      await setViewportMetrics(metrics);
      await pinned('simulated keyboard/browser chrome '+JSON.stringify(metrics));
    }
    await restoreViewportMetrics();
    await pinned('viewport restored');
    if(engine===chromium){
      const cdp=await page.context().newCDPSession(page);
      for(const scale of [1.5,2,1]){await cdp.send('Emulation.setPageScaleFactor',{pageScaleFactor:scale});await pinned('real visual viewport scale '+scale);}
      await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,left:0,right:0,bottom:34}});
      await pinned('safe area');
      assert.equal(await bar.locator(':scope > div').evaluate(el=>getComputedStyle(el).paddingBottom),'42px');
      await cdp.send('Emulation.setSafeAreaInsetsOverride',{insets:{top:0,left:0,right:0,bottom:0}});
    }
    await page.evaluate(()=>window.editorFixture.navigate('/feed/edit-event/fixture-event'));
    await page.getByRole('heading',{name:'Edit Event',exact:true}).waitFor();
    await pinned('edit route');await fits('edit route');await readable();
    const usableChrome=async()=>{
      const hit=await page.evaluate(()=>{
        const selectors=['[data-dvnt-tab-bar] [aria-label="Create"]','[data-dvnt-tab-bar] [aria-label="Home"]','[aria-label="Unsaved changes"] button:last-child'];
        return selectors.map(selector=>{const el=document.querySelector(selector),r=el.getBoundingClientRect(),hit=document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);return {selector,clickable:el===hit||el.contains(hit),rect:r.toJSON()};});
      });
      assert.equal(hit.every(result=>result.clickable),true,'save + navigation controls must both be clickable: '+JSON.stringify(hit));
    };
    await usableChrome();
    for(const metrics of [{height:500,offsetTop:0},{height:470,offsetTop:70},{height:852,offsetTop:0}]){
      await setViewportMetrics(metrics);await pinned('edit viewport divergence '+JSON.stringify(metrics));await usableChrome();
      const saveBottom=await page.getByRole('region',{name:'Unsaved changes'}).evaluate(el=>el.getBoundingClientRect().bottom);
      assert.ok(Math.abs(saveBottom-(metrics.height+metrics.offsetTop-78))<1,'save bar must track the visible viewport above the raised Create control');
    }
    await restoreViewportMetrics();await pinned('edit viewport recovery');await usableChrome();
    await page.getByLabel('Sell tickets for this event').check();
    await page.getByRole('button',{name:'Add Tier',exact:true}).click();
    const sale=page.locator('input[type="datetime-local"]').last();
    await sale.fill('2026-12-30T18:00');
    await page.setViewportSize({width:320,height:568});await nextFrame();await fits('edit tier date + Clear at320');await readable();await usableChrome();
    await page.setViewportSize({width:393,height:852});await nextFrame();
    await page.getByLabel('Go public at').fill('2026-12-30T18:00');
    await page.getByRole('button',{name:'Clear',exact:true}).first().click();
    for(const top of [0,900,99999,0]){await page.evaluate(y=>scrollTo(0,y),top);await pinned('edit scroll '+top);}
    await page.screenshot({path:path.join(dir,'edit-event.png')});
    await page.getByRole('button',{name:'Home',exact:true}).click();
    await page.getByRole('heading',{name:'Feed fixture'}).waitFor();await nextFrame();
    assert.equal(await page.getByRole('region',{name:'Unsaved changes'}).count(),0);
    const restoredChrome=()=>bar.evaluate(el=>({bottom:el.style.bottom,top:el.style.top,transform:el.style.transform,viewport:el.style.getPropertyValue('--dvnt-visible-bottom')}));
    assert.deepEqual(await restoredChrome(),{bottom:'0px',top:'',transform:'',viewport:''},'leaving the editor must restore shared non-editor chrome');
    await setViewportMetrics({height:500,offsetTop:70});await nextFrame();
    assert.equal((await restoredChrome()).viewport,'','editor viewport listeners must be removed on navigation');
    await restoreViewportMetrics();
    await page.goBack();await page.getByRole('heading',{name:'Edit Event',exact:true}).waitFor();await pinned('back to edit');await usableChrome();
    await page.goBack();await page.getByRole('heading',{name:'Create event',exact:true}).waitFor();
    assert.equal(await page.getByPlaceholder("What's the event called?").inputValue(),'Retain this draft');
    await pinned('back to create');
    console.log('PASS complete create/edit screens: real Tailwind, 320–1440px + landscape, scroll, expanded tickets/add-ons, publication field, focus fonts, viewport divergence/recovery, real Chromium zoom + safe area, route cleanup/back draft retention, edit savebar recovery + hit testing. Physical iOS keyboard remains a device check. Evidence:',dir);
    assert.deepEqual(errors,[]);
  }catch(error){if(page){console.error('Failure page:',await page.locator('body').innerText().catch(()=>''));await page.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});}throw error;}finally{await browser?.close();await new Promise(resolve=>server?server.close(resolve):resolve());}
})().catch(e=>{console.error(e);process.exitCode=1});
