#!/usr/bin/env node
/**
 * Render the production SiteChrome -> AppShell / WebAppShell composition.
 * Only routing, auth/services, marketing imports and visual leaves are fixtures.
 * No media, live room, account, network, build or device permission is used.
 * Run: NODE_PATH=/path/to/tools/node_modules node scripts/test-lynk-shell-chrome.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { build } = require('esbuild');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '..');
const ROOMS = ['/feed/sneaky-lynk/room/fixture-room', '/feed/lynk/fixture-room'];
const NORMAL = ['/feed/messages', '/feed/sneaky-lynk/create', '/feed/sneaky-lynk/billing'];

const fixtures = new Map([
  ['fixture', `
    import {useSyncExternalStore} from 'react';
    const listeners=new Set();
    let state={pathname:'/',feedLayout:true,auth:{isAuthenticated:false,_hasHydrated:false,authStatus:'loading',user:null}};
    export const f={mounts:0,unmounts:0,routes:[],pendingSessions:[],sessionReads:0,
      set(patch){state={...state,...patch};listeners.forEach(fn=>fn())},
      auth(patch){this.set({auth:{...state.auth,...patch}})},
      state:()=>state,
      router:{push(url){f.routes.push(['push',url]);f.set({pathname:url})},replace(url){f.routes.push(['replace',url])}}};
    export const useFixture=()=>useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state,()=>state);
    export function useAuthStore(select){return select(useFixture().auth)}
    useAuthStore.getState=()=>({...state.auth,setUser(user){f.auth({user,isAuthenticated:!!user,authStatus:user?'authenticated':'anonymous'})}});
  `],
  ['expo-haptics', `export const impactAsync=()=>{throw Error('Haptics must not run')};export const ImpactFeedbackStyle={};export const notificationAsync=impactAsync;export const NotificationFeedbackType={};`],
  ['solito/navigation', `import {f,useFixture} from 'fixture';export const usePathname=()=>useFixture().pathname;export const useRouter=()=>f.router;`],
  ['@dvnt/app/lib/stores/auth-store', `export {useAuthStore} from 'fixture';`],
  ['@dvnt/app/lib/stores/guest-checkout-store', `export const useGuestCheckoutStore=select=>select({open:false,eventId:null});`],
  ['@dvnt/app/lib/hooks/use-notifications-query', `export const useBadges=()=>({data:{unread:0}});`],
  ['@dvnt/app/lib/hooks/use-messages', `export const useUnreadMessageCount=()=>({data:0});`],
  ['@dvnt/app/lib/auth/supabase-jwt', `export const ensureSupabaseJwt=async()=>{};`],
  ['@dvnt/app/lib/auth/review-return', `export const clearReviewReturnOutsideSetup=()=>{};`],
  ['@dvnt/app/lib/auth-client', `import {f} from 'fixture';export const getSession=()=>{f.sessionReads++;return new Promise(resolve=>f.pendingSessions.push(resolve))};export const resumeAuthSession=async()=>{throw Error('Unexpected session resume')};`],
  ['@dvnt/app/lib/api/privileged', `export const syncAuthUser=async()=>{throw Error('Unexpected profile request')};`],
  ['@dvnt/app/lib/auth/hydrate-auth-profile', `export const hydrateAuthProfile=user=>user;`],
  ['@dvnt/app/lib/auth/continuation-guard', `export const captureAuthContinuation=()=>({isCurrent:()=>true,release(){}});`],
  ['@dvnt/app/lib/auth/session-lifecycle', `export const getSessionLifecycle=()=>({epoch:1,authId:'fixture-auth'});`],
  ['@dvnt/app/features/screens/landing/sections/GlassHeader', `export const GlassHeader=()=>null;`],
  ['@dvnt/app/features/screens/landing/sections/Footer', `export const Footer=()=>null;`],
  ['next/dynamic', `import React from 'react';export default function dynamic(loader){return function MarketingLeaf(){return React.createElement('div',{'data-marketing-chrome':String(loader).includes('GlassHeader')?'header':'footer'})}}`],
  ['@dvnt/app/components/logo', `import React from 'react';export default function Logo(){return <span data-brand-logo>DVNT</span>}`],
  ['@dvnt/app/components/ui/html', `
    import React from 'react';import {StyleSheet} from 'react-native';
    export const Main=({children,style,...props})=><main {...props} style={StyleSheet.flatten(style)}>{children}</main>;
    export const Header=({children,style,...props})=><header {...props} style={StyleSheet.flatten(style)}>{children}</header>;
  `],
]);

async function loadComposition() {
  const bundle = await build({
    stdin: { resolveDir: ROOT, loader: 'tsx', contents: `
      import React,{useEffect} from 'react';
      import {SiteChrome} from './apps/web/src/components/site-chrome';
      import {WebAppShell} from './packages/app/components/web-app-shell.web';
      import {f,useFixture} from 'fixture';
      export {f};
      export {roomReturnPath} from './packages/app/lib/auth/room-return';
      export {lynkRoomShareUrl} from './packages/app/features/sneaky-lynk/room-links';
      export {shareUrls} from './packages/app/lib/deep-linking/share-link';
      // A media-lifetime sentinel, not a copied room/header implementation.
      function Page(){useEffect(()=>{f.mounts++;return()=>{f.unmounts++}},[]);
        return <section data-page-probe><input aria-label="Preserved room state" defaultValue="unchanged"/>
          <button aria-label="Leave fixture room" onClick={()=>f.router.push('/feed/messages')}>Leave</button></section>}
      export function Tree(){const state=useFixture();const page=<Page key={state.pathname}/>;
        return <SiteChrome>{state.feedLayout?<WebAppShell>{page}</WebAppShell>:page}</SiteChrome>}
    ` },
    bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external', jsx: 'automatic',
    tsconfigRaw: { compilerOptions: { jsx: 'react-jsx', jsxImportSource: 'react' } },
    nodePaths: (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean),
    plugins: [{ name: 'synthetic-service-boundaries', setup(b) {
      b.onResolve({filter: /.*/}, args => {
        if (fixtures.has(args.path)) return {path:args.path,namespace:'fixture'};
        if (args.path === 'react-native') return {path:require.resolve('react-native-web'),external:true};
        if (args.path.startsWith('@dvnt/app/')) {
          const base=path.join(ROOT,'packages/app',args.path.slice('@dvnt/app/'.length));
          const resolved=['.web.tsx','.web.ts','.tsx','.ts','/index.ts'].map(ext=>base+ext).find(fs.existsSync);
          assert.ok(resolved,'Unresolved app import: '+args.path);return {path:resolved};
        }
        if (args.path.startsWith('@/')) return {path:path.join(ROOT,'apps/web/src',args.path.slice(2)+'.tsx')};
      });
      b.onLoad({filter:/.*/,namespace:'fixture'}, args=>({contents:fixtures.get(args.path),loader:'tsx',resolveDir:ROOT}));
    }}],
  });
  const module={exports:{}};
  new Function('require','module','exports',bundle.outputFiles[0].text)(createRequire(__filename),module,module.exports);
  return module.exports;
}

// Native navigator contracts are checked from the real TSX AST, never a copied
// route list. This does not pretend to run UIKit/Expo Router in a DOM fixture.
function checkNativeStack() {
  const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
  const parse=p=>ts.createSourceFile(p,read(p),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
  const nodes=(node,predicate)=>{const out=[];function visit(n){if(predicate(n))out.push(n);ts.forEachChild(n,visit)}visit(node);return out};
  const attr=(el,name)=>el.attributes.properties.find(p=>ts.isJsxAttribute(p)&&p.name.text===name);
  const objectAttr=(el,name)=>{const a=attr(el,name);assert.ok(a?.initializer&&ts.isJsxExpression(a.initializer)&&ts.isObjectLiteralExpression(a.initializer.expression),name+' must remain an inspectable config object');return a.initializer.expression};
  const booleanProp=(obj,name)=>{const p=obj.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText()===name);assert.ok(p,name+' must be explicit');assert.ok([ts.SyntaxKind.TrueKeyword,ts.SyntaxKind.FalseKeyword].includes(p.initializer.kind),name+' must be boolean');return p.initializer.kind===ts.SyntaxKind.TrueKeyword};
  const shared='packages/app/features/routes/screens/(protected)/';
  const outer=parse(shared+'_layout.tsx');
  const stacks=nodes(outer,n=>ts.isJsxOpeningElement(n)&&n.tagName.getText()==='Stack');
  assert.equal(stacks.length,1);assert.equal(booleanProp(objectAttr(stacks[0],'screenOptions'),'headerShown'),false);
  const transitionConfig=nodes(outer,n=>ts.isVariableDeclaration(n)&&n.name.getText()==='screenTransitionConfig')[0];
  assert.ok(transitionConfig);assert.equal(nodes(transitionConfig,n=>ts.isPropertyAssignment(n)&&n.name.getText()==='headerShown').length,0,'platform transition spread cannot override header visibility');
  const screens=nodes(outer,n=>(ts.isJsxOpeningElement(n)||ts.isJsxSelfClosingElement(n))&&n.tagName.getText()==='Stack.Screen');
  const tabs=screens.find(n=>attr(n,'name')?.initializer?.text==='(tabs)');
  assert.ok(tabs);assert.equal(booleanProp(objectAttr(tabs,'options'),'headerShown'),true);assert.match(objectAttr(tabs,'options').getText(),/header:\s*\(\)\s*=>\s*<TabsHeader\s*\/>/);
  for(const screen of screens.filter(n=>/^sneaky-lynk(?:\/|$)|^lynk(?:\/|$)/.test(attr(n,'name')?.initializer?.text||''))){
    const options=attr(screen,'options');if(options)assert.equal(booleanProp(objectAttr(screen,'options'),'headerShown'),false);
  }
  const nested=parse(shared+'sneaky-lynk/_layout.tsx');
  const stack=nodes(nested,n=>ts.isJsxOpeningElement(n)&&n.tagName.getText()==='Stack')[0];
  assert.ok(stack);assert.equal(booleanProp(objectAttr(stack,'screenOptions'),'headerShown'),false);
  const room=nodes(nested,n=>ts.isJsxSelfClosingElement(n)&&n.tagName.getText()==='Stack.Screen').find(n=>attr(n,'name')?.initializer?.text==='room/[id]');
  assert.ok(room);assert.equal(booleanProp(objectAttr(room,'options'),'gestureEnabled'),false);
  assert.doesNotMatch(objectAttr(room,'options').getText(),/headerShown\s*:\s*true/);
  assert.match(read('packages/app/lib/navigation/transition-stack.tsx'),/export const TransitionStack = Stack;/);
  for(const suffix of ['_layout','sneaky-lynk/_layout'])assert.ok(read('apps/mobile/app/(protected)/'+suffix+'.tsx').includes(`export { default } from '@dvnt/app/features/routes/screens/(protected)/${suffix}'`));
  console.log('PASS native source/config contract: app and room stacks hide global headers; only tabs restore TabsHeader; room gestures stay guarded.');
}

(async()=>{
  const {Window}=await import(require.resolve('happy-dom'));
  const window=new Window({url:'https://fixture.invalid/feed/messages',width:390,height:844});
  const originals=new Map();
  for(const name of ['window','document','navigator','HTMLElement','Element','Node','ShadowRoot','Event','MutationObserver','ResizeObserver','fetch','requestAnimationFrame','cancelAnimationFrame','getComputedStyle','IS_REACT_ACT_ENVIRONMENT']){
    originals.set(name,Object.getOwnPropertyDescriptor(globalThis,name));
    Object.defineProperty(globalThis,name,{configurable:true,writable:true,value:name==='IS_REACT_ACT_ENVIRONMENT'?true:name==='window'?window:typeof window[name]==='function'&&['requestAnimationFrame','cancelAnimationFrame','getComputedStyle'].includes(name)?window[name].bind(window):window[name]});
  }
  let networkRequests=0;
  window.fetch=globalThis.fetch=()=>{networkRequests++;throw Error('Network is forbidden in shell regression')};
  const React=require('react'),{createRoot,hydrateRoot}=require('react-dom/client'),{renderToString}=require('react-dom/server');
  Object.defineProperty(document.documentElement,'clientWidth',{configurable:true,get:()=>window.innerWidth});
  Object.defineProperty(document.documentElement,'clientHeight',{configurable:true,get:()=>window.innerHeight});
  const {Tree,f,roomReturnPath,lynkRoomShareUrl,shareUrls}=await loadComposition();
  const errors=[];const originalError=console.error;console.error=(...args)=>{errors.push(args.map(String).join(' '));originalError(...args)};
  let root=null,container;
  const act=fn=>React.act(async()=>{await fn();await Promise.resolve()});
  const auth={isAuthenticated:true,_hasHydrated:true,authStatus:'authenticated',user:{id:'fixture-user',authId:'fixture-auth',username:'fixture'}};
  const resize=width=>act(()=>{window.happyDOM.setWindowSize({width,height:844});window.dispatchEvent(new window.Event('resize'))});
  const chromeAbsent=label=>{assert.equal(document.querySelectorAll('[aria-label="App header"]').length,0,label+' app header');assert.equal(document.querySelectorAll('nav[aria-label="Primary"]').length,0,label+' rail/tab bar');assert.equal(document.querySelectorAll('[data-marketing-chrome]').length,0,label+' marketing chrome');assert.equal(document.querySelectorAll('[data-brand-logo]').length,0,label+' site logo')};
  const normalChrome=(width,feedLayout=true)=>{assert.equal(document.querySelectorAll('nav[aria-label="Primary"]').length,1,'one primary nav');assert.equal(!!document.querySelector('[aria-label="App header"]'),width<768,'mobile app header');assert.equal(!!document.querySelector('[data-dvnt-tab-bar]'),width<768,'mobile portalled tabs');assert.equal(document.querySelectorAll('[data-marketing-chrome]').length,0,'no marketing for authenticated app');if(feedLayout)assert.match(document.querySelector('main main')?.className||'',/pb-\[calc\(env\(safe-area-inset-bottom\)\+88px\)\]/,'normal routes restore bottom clearance')};
  const reset=async(pathname,initialAuth,hydrate=false,feedLayout=true)=>{
    if(root)await act(()=>root.unmount());
    document.body.innerHTML='<div id="root"></div>';container=document.getElementById('root');
    f.routes.length=0;f.pendingSessions.length=0;f.mounts=0;f.unmounts=0;f.set({pathname,auth:initialAuth,feedLayout});
    if(hydrate){container.innerHTML=renderToString(React.createElement(Tree));chromeAbsent('server render');await act(()=>{root=hydrateRoot(container,React.createElement(Tree),{onRecoverableError:error=>errors.push(String(error))})})}
    else await act(()=>{root=createRoot(container);root.render(React.createElement(Tree))});
  };
  try {
    for(const route of ROOMS){
      await resize(390);
      await reset(route,{isAuthenticated:false,_hasHydrated:false,authStatus:'loading',user:null},true);
      chromeAbsent(route+' hydration');assert.equal(f.mounts,0,'no protected content before hydration');
      await act(()=>f.auth({_hasHydrated:true,authStatus:'anonymous'}));
      chromeAbsent(route+' guest');assert.equal(f.mounts,0,'guest never mounts protected room');assert.ok(f.routes.some(([kind])=>kind==='replace'),'guest receives auth redirect');
      await act(()=>f.auth(auth));
      chromeAbsent(route+' authenticated');assert.equal(f.mounts,1,'authenticated room mounts once');
      const sentinel=document.querySelector('[data-page-probe]');const input=sentinel.querySelector('input');input.value='room remains mounted';
      assert.equal(sentinel.closest('main').className,'','immersive room has no app-header/tab clearance');
      for(const width of [767,768,1024,1440,390]){
        await resize(width);chromeAbsent(route+' width '+width);
        assert.ok(document.querySelector('[data-page-probe]')===sentinel,'breakpoints preserve the room node');assert.equal(input.value,'room remains mounted');assert.equal(f.mounts,1);assert.equal(f.unmounts,0);
      }
      // Use a page exit action, then route changes representing Back/Forward.
      await act(()=>document.querySelector('[aria-label="Leave fixture room"]').click());normalChrome(390);
      for(const pathname of NORMAL){
        await act(()=>f.set({pathname}));normalChrome(390);
        const page=document.querySelector('[data-page-probe]');const mounts=f.mounts;
        for(const width of [768,1440,767,390]){await resize(width);normalChrome(width);assert.ok(document.querySelector('[data-page-probe]')===page,'real AppShell preserves its child across breakpoints');assert.equal(f.mounts,mounts)}
        await act(()=>f.set({pathname:route}));chromeAbsent('back into room');
        await act(()=>f.set({pathname}));normalChrome(390);
      }
      await reset(route,auth,true);chromeAbsent('cached authenticated SSR/hydration');assert.equal(f.mounts,1);
      console.log('PASS '+route+': SSR/hydration, guest gating, immersive shell, stable room across breakpoints, exit and Back/Forward chrome restoration.');
    }
    // /video/room is a real legacy frontend route, NOT a child of the /feed
    // layout. Exercise SiteChrome directly, preserving its existing auth policy.
    await resize(390);
    await reset('/video/room/fixture-room',{isAuthenticated:false,_hasHydrated:false,authStatus:'loading',user:null},true,false);
    chromeAbsent('legacy frontend hydration');assert.equal(f.mounts,1);
    const legacyPage=document.querySelector('[data-page-probe]');
    await act(()=>f.auth({_hasHydrated:true,authStatus:'anonymous'}));chromeAbsent('legacy signed-out room');
    await act(()=>f.auth(auth));chromeAbsent('legacy authenticated room');
    for(const width of [767,768,1440,390]){
      await resize(width);chromeAbsent('legacy width '+width);
      assert.ok(document.querySelector('[data-page-probe]')===legacyPage,'legacy room survives auth and breakpoint changes');assert.equal(f.mounts,1);assert.equal(f.unmounts,0);
    }
    await act(()=>f.set({pathname:'/video/rooms'}));normalChrome(390,false);
    const listingPage=document.querySelector('[data-page-probe]');const listingMounts=f.mounts;
    for(const width of [768,1440,390]){await resize(width);normalChrome(width,false);assert.ok(document.querySelector('[data-page-probe]')===listingPage);assert.equal(f.mounts,listingMounts)}
    await act(()=>f.set({pathname:'/video/room/fixture-room'}));chromeAbsent('return to legacy room');
    await act(()=>f.set({pathname:'/video/rooms'}));normalChrome(390,false);
    console.log('PASS legacy /video/room frontend-only shell: no site logo/header before or after auth, stable content on resize, listing navigation restored on exit.');
    // Generated HTTPS links and legacy aliases normalize through the same
    // real helper used by middleware; config redirects are independently run
    // by test-lynk-web-routes.cjs. Render the resulting canonical destination.
    const generated=[lynkRoomShareUrl('fixture-room'),shareUrls.sneakyLynk('fixture-room')];
    const aliases=[...generated.map(url=>new URL(url).pathname),'/sneaky/fixture-room','/sneaky-lynk/fixture-room','/feed/sneaky-lynk/fixture-room','/feed/sneaky-lynk/room/fixture-room/'];
    await reset('/feed/messages',auth);
    for(const alias of aliases){
      const target=roomReturnPath(alias+'?title=Ignored&returnTo=%2Ffeed');assert.equal(target,ROOMS[0],alias+' canonical target');
      await act(()=>f.set({pathname:target}));chromeAbsent(alias);
      await act(()=>f.set({pathname:'/feed/messages'}));normalChrome(390);
    }
    console.log('PASS generated invite URLs and legacy aliases: middleware normalization enters the chrome-free shell and exit restores navigation.');
    // A persisted profile is insufficient for the canonical room: execute the
    // real WebAppShell bootstrap and release only the synthetic session read.
    await reset(ROOMS[0],{...auth,_hasHydrated:false,authStatus:'loading'},true);
    await act(()=>f.auth({_hasHydrated:true}));chromeAbsent('pending session');assert.equal(f.mounts,0);assert.equal(f.pendingSessions.length,1);
    await act(()=>f.pendingSessions.shift()({data:{session:{id:'fixture-session'},user:{id:'fixture-auth'}},error:null}));
    chromeAbsent('confirmed session');assert.equal(f.mounts,1);assert.equal(f.state().auth.authStatus,'authenticated');
    await act(()=>f.auth({isAuthenticated:false,authStatus:'anonymous',user:null}));chromeAbsent('logout in room');assert.equal(document.querySelectorAll('[data-page-probe]').length,0);
    console.log('PASS canonical session bootstrap: no room before verified fixture session; logout unmounts protected content without showing global chrome.');
    checkNativeStack();assert.equal(networkRequests,0,'no fixture attempted network IO');assert.deepEqual(errors,[],'no render, hydration or runtime errors');
  } finally {
    if(root)await act(()=>root.unmount());console.error=originalError;await window.happyDOM.close();
    for(const [name,descriptor] of originals){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name]}
  }
})().catch(error=>{console.error(error);process.exitCode=1});
