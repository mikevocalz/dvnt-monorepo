/** Settings + production SiteChrome/GlassHeader/AppShell composition.
 * Real RN-web and Tailwind layout; only Next routing/dynamic loading, service
 * boundaries, logo artwork and the footer are fixtures. Never signs in or
 * touches a backend. --dom checks composition/history without geometry;
 * --build-only compiles without starting Chromium. CI runs the browser mode.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { build } = require('esbuild');
const { compile } = require('tailwindcss');
const root = path.resolve(__dirname, '..');
const app = path.join(root, 'packages/app');
const fixtures = {
  fixture: `
    import {useSyncExternalStore} from 'react';
    const listeners=new Set();
    let state={path:location.pathname,hydrated:false,owner:null,loading:false};
    export const f={
      state:()=>state,
      set(patch){state={...state,...patch};listeners.forEach(fn=>fn())},
      router:{
        push(url){history.pushState(null,'',url);f.set({path:location.pathname});window.scrollTo(0,0)},
        replace(url){history.replaceState(null,'',url);f.set({path:location.pathname})},
        back(){history.back()},
      },
    };
    addEventListener('popstate',()=>{f.set({path:location.pathname});window.scrollTo(0,0)});
    export const useFixture=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state,()=>state);
    export function useAuthStore(select){const s=useFixture();return select({
      isAuthenticated:!!s.owner,_hasHydrated:s.hydrated,
      user:s.owner?{id:s.owner,authId:s.owner,username:s.owner,name:s.owner}:null,
      logout:async()=>f.set({owner:null}),
    })}
  `,
  'solito/navigation': `import {f,useFixture} from 'fixture';export const usePathname=()=>useFixture().path;export const useRouter=()=>f.router;`,
  'next/dynamic': `import React,{lazy,Suspense} from 'react';export default loader=>{const Component=lazy(()=>loader().then(defaultExport=>({default:defaultExport})));return props=><Suspense fallback={null}><Component {...props}/></Suspense>};`,
  '@dvnt/app/lib/stores/auth-store': `export {useAuthStore} from 'fixture';`,
  '@dvnt/app/lib/stores/guest-checkout-store': `export const useGuestCheckoutStore=s=>s({open:false,eventId:null});`,
  '@dvnt/app/lib/auth/supabase-jwt': `export const ensureSupabaseJwt=async()=>{};`,
  '@dvnt/app/lib/hooks/use-notifications-query': `export const useBadges=()=>({data:{unread:0}});`,
  '@dvnt/app/lib/hooks/use-messages': `export const useUnreadMessageCount=()=>({data:0});`,
  '@dvnt/app/lib/stores/app-store': `export const useAppStore=s=>s({nsfwEnabled:false,feedMode:'list',setNsfwEnabled(){},setFeedMode(){}});`,
  '@dvnt/app/lib/hooks/use-verified-gate': `export const useVerifiedGate=()=>()=>{};`,
  '@dvnt/app/lib/hooks/use-user-settings': `import {useFixture} from 'fixture';export const usePrivacySettings=()=>({isLoading:useFixture().loading,data:{privateAccount:false,activityStatus:true,readReceipts:true,showLikes:true}});export const useUpdatePrivacySettings=()=>({mutate(){throw Error('Unexpected preference write')}});`,
  '@dvnt/app/lib/hooks/use-member-proximity': `export const useSyncMemberProximityPresence=()=>({withdrawalPending:false,stop(){throw Error('Unexpected location action')}});`,
  '@dvnt/app/lib/hooks/use-exact-distance-consent': `export const useExactDistanceConsent=()=>({enabled:false,busy:false,withdrawalPending:false,update(){throw Error('Unexpected exact-distance action')}});`,
  '@dvnt/app/lib/stores/events-location-store': `export const useEventsLocationStore=s=>s({activeCity:null,visibilityDurationId:'1h',preciseProximityGrant:false});export const useActiveCityVisibility=()=>null;`,
  '@dvnt/app/lib/stores/exact-distance-store': `export const EXACT_DISTANCE_COPY='Exact distances require separate consent';`,
  '@dvnt/app/features/settings/ui/LocationControls': `export const LocationControls=()=>null;`,
  '@dvnt/app/features/settings/follow-requests-panel': `export const FollowRequestsPanel=()=>null;`,
  '@dvnt/app/features/settings/follow-requests-setting': `export const FollowRequestsSetting=()=>null;`,
  '@dvnt/app/lib/stores/faq-store': `export const useFAQStore=s=>s({expandedIndex:null,toggleExpanded(){}});`,
  '@dvnt/app/features/screens/landing/sections/Footer': `export const Footer=()=> <footer data-fixture-footer>Public footer</footer>;`,
  '@dvnt/app/components/logo': `export default ()=> <span style={{display:'block',width:78,height:30}}>DVNT</span>;`,
  // Mirror @expo/html-elements' actual web primitives: Header/Nav are Views
  // with semantic roles; A is a Text link. Raw createElement omits View's
  // display:flex baseline and falsely stacks the desktop marketing nav.
  '@dvnt/app/components/ui/html': `import {View,Text} from 'react-native';export const Header=p=><View role="banner" {...p}/>;export const Nav=p=><View role="navigation" {...p}/>;export const A=p=><Text role="link" {...p}/>;`,
};
const entry = `
  import React from 'react';import {createRoot} from 'react-dom/client';
  import {SiteChrome} from './apps/web/src/components/site-chrome';
  import {SettingsHomeScreen} from './packages/app/features/settings/settings-home.web';
  import {PrivacyScreen} from './packages/app/features/settings/privacy.web';
  import {LegalPage} from './packages/app/features/settings/legal-page.web';
  import {f,useFixture} from 'fixture';
  function App(){const s=useFixture();const page=s.path==='/settings'?<SettingsHomeScreen/>:
    s.path==='/settings/privacy'?<PrivacyScreen/>:
    s.path==='/settings/privacy-policy'?<LegalPage slug="privacy-policy" title="Privacy Policy"/>:
    <main style={{paddingTop:110,minHeight:1500}}><h1>Public fixture</h1><button onClick={()=>f.router.push('/settings')}>Open settings</button></main>;
    return <SiteChrome>{page}</SiteChrome>;
  }
  window.settingsShell=f;window.settingsRoot=createRoot(document.getElementById('root'));window.settingsRoot.render(<App/>);
`;

async function buildFixture() {
  const result = await build({
    stdin:{contents:entry,resolveDir:root,loader:'tsx'},bundle:true,write:false,
    platform:'browser',format:'iife',jsx:'automatic',tsconfigRaw:{},metafile:true,
    nodePaths:(process.env.NODE_PATH||'').split(path.delimiter).filter(Boolean),
    resolveExtensions:['.web.tsx','.web.ts','.tsx','.ts','.js','.json'],
    alias:{'react-native':'react-native-web'},
    define:{'process.env.NODE_ENV':'"test"',__DEV__:'true'},
    plugins:[{name:'service-boundaries',setup(b){
      b.onResolve({filter:/.*/},a=>{
        let key=a.path;
        if(key.startsWith('.'))key='@dvnt/app/'+path.relative(app,path.resolve(a.resolveDir,key)).replace(/\\/g,'/').replace(/\.web(?:\.tsx?)?$/,'');
        if(fixtures[key])return {path:key,namespace:'fixture'};
        let base;
        if(a.path.startsWith('@dvnt/app/'))base=path.join(app,a.path.slice(10));
        if(a.path.startsWith('@/'))base=path.join(root,'apps/web/src',a.path.slice(2));
        if(base){const file=['','.web.tsx','.web.ts','.tsx','.ts','/index.ts'].map(ext=>base+ext).find(p=>fs.existsSync(p)&&fs.statSync(p).isFile());assert.ok(file,a.path);return {path:file}}
      });
      b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:fixtures[a.path],loader:'tsx',resolveDir:root}));
    }}],
  });
  // Compile the classes from the actual production files in this bundle.
  const sources=Object.keys(result.metafile.inputs).filter(p=>!p.startsWith('fixture:')&&/\.(?:tsx?|jsx?)$/.test(p)&&!p.includes('node_modules'));
  const tokens=sources.flatMap(p=>fs.readFileSync(path.resolve(root,p),'utf8').match(/[a-zA-Z0-9_!@#%./:[\](),+*=&<>-]+/g)||[]);
  const tw=path.dirname(require.resolve('tailwindcss/package.json'));
  const compiler=await compile(fs.readFileSync(path.join(tw,'theme.css'),'utf8')+'\n'+fs.readFileSync(path.join(tw,'preflight.css'),'utf8')+'\n@tailwind utilities;');
  return {js:result.outputFiles[0].text,css:compiler.build(tokens)};
}

async function domChecks(bundle) {
  const {Window}=await import(require.resolve('happy-dom'));
  const w=new Window({url:'https://fixture.invalid/settings',console});
  const wait=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,20))}assert.ok(fn(),'DOM did not settle')};
  w.document.body.innerHTML='<div id="root"></div>';w.eval(bundle.js);
  const header=()=>w.document.querySelector('header');
  const close=()=>w.document.querySelector('[aria-label="Close"]');
  try {
    await wait(close);assert.equal(!!header(),false,'no marketing header before hydration');
    const node=close();w.settingsShell.set({hydrated:true});await wait(close);
    assert.equal(close(),node,'guest hydration preserves the settings page');
    assert.equal(!!header(),false);await wait(()=>w.document.querySelector('[data-fixture-footer]'));assert.equal(!!header(),false,'no marketing header after hydration');
    for(const owner of ['alice','bob',null]){
      w.settingsShell.set({owner});await wait(()=>owner?!!w.document.querySelector('[aria-label="Primary"]'):!!w.document.querySelector('[data-fixture-footer]'));
      assert.equal(!!header(),false,'account changes do not add a competing header');
      assert.ok(close());
    }
    w.settingsShell.router.push('/settings/privacy');await wait(()=>w.document.querySelector('h1')?.textContent==='Privacy');assert.equal(!!header(),false);
    w.settingsShell.router.push('/settings/privacy-policy');await wait(()=>w.document.querySelector('h1')?.textContent==='Privacy Policy');assert.equal(!!header(),false);
    w.settingsShell.router.push('/privacy');await wait(()=>!!header());assert.ok(w.document.querySelector('a[href="/auth/login"]'),'public route restores actual GlassHeader');
    const nav=w.document.querySelector('header nav');assert.ok(nav);
    assert.equal(w.getComputedStyle(nav).display,'flex','semantic Nav retains the production View baseline');
    assert.equal(w.getComputedStyle(nav).flexDirection,'row','desktop marketing links form one row');
    w.settingsShell.router.push('/auth/login');await wait(()=>!header());assert.equal(w.document.querySelector('[data-fixture-footer]'),null);
    console.log('PASS real settings/shell DOM composition across hydration, account replacement, nested legal and public/auth navigation. Geometry and native browser history NOT tested in --dom.');
  } finally {w.settingsRoot.unmount();await w.happyDOM.close()}
}

async function browserChecks(bundle) {
  const {chromium}=require('playwright');
  const browser=await chromium.launch({headless:true,executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,args:['--no-sandbox']});
  try {
    for(const width of [390,767,768,1170,1280]){
      const page=await browser.newPage({viewport:{width,height:844}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',r=>r.request().isNavigationRequest()?r.fulfill({contentType:'text/html',body:'<!doctype html><html><body><div id="root"></div></body></html>'}):r.abort());
      await page.goto('https://fixture.invalid/');await page.addStyleTag({content:bundle.css});await page.addScriptTag({content:bundle.js});
      const title=t=>page.getByRole('heading',{name:t,exact:true,level:1});
      const close=()=>page.getByRole('button',{name:'Close',exact:true});
      const route=path=>page.evaluate(path=>settingsShell.router.push(path),path);
      const hitClose=async()=>{
        const hit=await close().evaluate(el=>{const r=el.getBoundingClientRect();return {width:r.width,height:r.height,visible:r.top>=0&&r.bottom<=innerHeight,hit:el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))}});
        assert.ok(hit.width>=36&&hit.height>=36&&hit.visible&&hit.hit,JSON.stringify(hit));
        assert.equal(await page.locator('header').count(),0,'no competing global header');
      };
      await page.locator('header').waitFor();
      // The synthetic public page must clear the real marketing header before
      // entering Settings. Never force a click through an obstructing layer.
      await page.waitForFunction(()=>{const el=Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Open settings');if(!el)return false;const r=el.getBoundingClientRect();return el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2))});
      await page.getByRole('button',{name:'Open settings'}).click();await title('Settings').waitFor();await hitClose();
      await page.evaluate(()=>settingsShell.set({hydrated:true}));await hitClose();
      for(const owner of [null,'alice','bob',null]){
        await page.evaluate(owner=>settingsShell.set({owner}),owner);
        await page.waitForFunction(owner=>owner?!!document.querySelector('[aria-label="Primary"]'):!!document.querySelector('[data-fixture-footer]'),owner);
        await hitClose();
        assert.equal(await page.locator('[data-dvnt-tab-bar]').count(),owner&&width<768?1:0,'retain signed-in phone tabs');
        // Actual Settings row -> actual Privacy; scroll exposes sticky-vs-sticky
        // collisions that an isolated screen or initial top-of-page check misses.
        await page.getByRole('button',{name:'Privacy',exact:true}).click();await title('Privacy').waitFor();await hitClose();
        await page.evaluate(()=>window.scrollTo(0,250));await hitClose();
        await close().click();await title('Settings').waitFor();await hitClose();
        await page.goForward();await title('Privacy').waitFor();await hitClose();
        await page.goBack();await title('Settings').waitFor();await hitClose();
        // Repeated Close after the previous transition unwinds one screen each.
        await route('/settings/privacy');await title('Privacy').waitFor();await close().click();await title('Settings').waitFor();
        await close().click();await title('Public fixture').waitFor();
        await page.locator('header').waitFor();
        await route('/settings');await title('Settings').waitFor();
      }
      // Close while a settings read is pending; late completion must not restore
      // the dismissed route. Then browser Back/Forward restores correct chrome.
      await page.evaluate(()=>settingsShell.set({loading:true}));await route('/settings/privacy');await page.getByText('Loading settings...',{exact:true}).waitFor();await hitClose();
      await close().click();await title('Settings').waitFor();await page.evaluate(()=>settingsShell.set({loading:false}));await title('Settings').waitFor();
      await page.goForward();await title('Privacy').waitFor();await hitClose();
      await close().click();await title('Settings').waitFor();
      await route('/settings/privacy-policy');await title('Privacy Policy').waitFor();await page.evaluate(()=>scrollTo(0,450));await hitClose();await close().click();await title('Settings').waitFor();
      // Changing viewport must keep the page node and its controls mounted.
      for(const owner of [null,'alice']){
        await page.evaluate(owner=>settingsShell.set({owner}),owner);
        await page.waitForFunction(owner=>owner?!!document.querySelector('[aria-label="Primary"]'):!!document.querySelector('[data-fixture-footer]'),owner);
        await close().evaluate(el=>el.dataset.preserved='yes');
        for(const next of [390,768,1280,width]){await page.setViewportSize({width:next,height:844});await hitClose();assert.equal(await close().getAttribute('data-preserved'),'yes')}
      }
      await route('/privacy');await page.locator('header').waitFor();
      await route('/auth/login');assert.equal(await page.locator('header').count(),0);
      assert.deepEqual(errors,[]);await page.close();
      console.log(`PASS settings shell ${width}px: hit testing, scroll, nested settings/legal, Close, Back/Forward, interrupted read, hydration/account changes, resize and restored marketing navigation.`);
    }
  } finally {await browser.close()}
}

(async()=>{
  const bundle=await buildFixture();
  if(process.argv.includes('--build-only')){console.log('PASS settings shell browser JS/CSS build; browser assertions NOT executed');return}
  if(process.argv.includes('--dom'))return domChecks(bundle);
  await browserChecks(bundle);
})().catch(error=>{console.error(error);process.exitCode=1});
