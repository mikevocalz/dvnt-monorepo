// Mount the production shell with synthetic auth/navigation. No real sessions.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript'),React=require('react'),{createRoot}=require('react-dom/client'),{JSDOM}=require('jsdom');
const ROOT=path.resolve(__dirname,'..'),dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid/public/events/42?section=reviews'});
Object.assign(global,{window:dom.window,document:dom.window.document});global.IS_REACT_ACT_ENVIRONMENT=true;
let state,root,navigation=[],version=0;const subscribers=new Set();
const auth=select=>{React.useSyncExternalStore(fn=>{subscribers.add(fn);return()=>subscribers.delete(fn)},()=>version);return select(state)};
const router={replace:target=>navigation.push(target)};
const caches=new Map();
function load(relative){const file=path.join(ROOT,relative);if(caches.has(file))return caches.get(file);const exports={};caches.set(file,exports);
const requireModule=name=>{
 if(name==='react'||name==='react/jsx-runtime')return require(name);
 if(name==='solito/navigation')return {useRouter:()=>router,usePathname:()=>window.location.pathname,useSearchParams:()=>new URLSearchParams(window.location.search)};
 if(name==='next/dynamic')return {default:()=>()=>React.createElement('div',{'data-marketing':'1'})};
 if(name.includes('auth-store'))return {useAuthStore:auth};
 if(name.includes('guest-checkout-store'))return {useGuestCheckoutStore:select=>select({open:false,eventId:null})};
 if(name.includes('member-event-route'))return load('packages/app/lib/auth/member-event-route.ts');
 if(name.includes('supabase-jwt'))return {ensureSupabaseJwt:async()=>{}};
 if(name.includes('web-chrome'))return {routeIsImmersive:()=>false};
 if(name.includes('chrome-error-boundary'))return {ChromeErrorBoundary:({children})=>children};
 if(name.includes('app-shell'))return {AppShell:({children})=>React.createElement('div',{'data-app':'1'},children)};
 throw Error('Unexpected import '+name);
};
const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
vm.runInNewContext(code,{exports,require:requireModule,window,document,URLSearchParams,console,setInterval:()=>1,clearInterval:()=>{}},{filename:file});return exports;}
const C=load('apps/web/src/components/site-chrome.tsx').SiteChrome;
const content=()=>React.createElement(C,null,React.createElement('div',{'data-event':'1'},'Event details'));
async function mount(url,patch={}){if(root)await React.act(async()=>root.unmount());dom.reconfigure({url:'https://fixture.invalid'+url});state={_hasHydrated:true,isAuthenticated:false,...patch};navigation=[];version++;root=createRoot(document.getElementById('root'));await React.act(async()=>root.render(content()));}
async function update(patch,url){await React.act(async()=>{Object.assign(state,patch);if(url)dom.reconfigure({url:'https://fixture.invalid'+url});version++;for(const fn of subscribers)fn();root.render(content());});}
const visible=selector=>!!document.querySelector(selector);
(async()=>{
 await mount('/public/events/42?section=reviews',{_hasHydrated:false,isAuthenticated:true});
 assert.deepEqual(navigation,[]);assert.equal(visible('[data-marketing]'),false);assert.equal(visible('[data-event]'),false,'no public flash before hydration');
 await update({_hasHydrated:true});assert.deepEqual(navigation,['/feed/events/42?section=reviews']);assert.equal(visible('[data-event]'),false,'no public content during replace');
 await update({},'/feed/events/42?section=reviews');assert.equal(visible('[data-app]'),true);assert.equal(visible('[data-event]'),true);assert.equal(navigation.length,1,'canonical destination cannot redirect again');
 await mount('/public/events/42?section=reviews#reviews');assert.equal(visible('[data-event]'),true,'signed-out visitors retain public detail');assert.equal(visible('[data-marketing]'),true);assert.deepEqual(navigation,[]);
 await update({isAuthenticated:true});assert.deepEqual(navigation,['/feed/events/42?section=reviews#reviews'],'sign-in while on public detail redirects preserving reviews');
 await mount('/public/events/42?promo=SAVE&section=reviews&next=//evil.invalid&id=99',{isAuthenticated:true});assert.deepEqual(navigation,['/feed/events/42?promo=SAVE&section=reviews']);
 await mount('/public/events/42',{_hasHydrated:false});await update({},'/public/events/85?section=reviews');await update({_hasHydrated:true,isAuthenticated:true});assert.deepEqual(navigation,['/feed/events/85?section=reviews'],'latest route wins when hydration finishes');
 await mount('/public/events/42',{_hasHydrated:false,isAuthenticated:true});await update({_hasHydrated:true,isAuthenticated:false});assert.deepEqual(navigation,[],'signed-out hydration does not use stale auth');assert.equal(visible('[data-event]'),true);
 await mount('/public/events/42?section=reviews',{isAuthenticated:true});await update({isAuthenticated:false},'/public/events/42?section=reviews');assert.equal(visible('[data-event]'),true,'expired session fallback can show public page without loop');assert.equal(navigation.length,1);
 for(const url of ['/public/events/42/embed','/public/events','/feed/events/42?section=reviews']){await mount(url,{isAuthenticated:true});assert.deepEqual(navigation,[],url);}
 await React.act(async()=>root.unmount());console.log('PASS public/member event entry: hydration, no flash, replace, auth changes, reviews/hash, query safety and navigation races');
})().catch(e=>{console.error(e);process.exitCode=1});
