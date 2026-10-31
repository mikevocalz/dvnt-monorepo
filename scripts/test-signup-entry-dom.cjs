// Mount the production signup-entry guard with deferred session IO; never a real signup.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const {createRoot} = require('react-dom/client');
const {JSDOM} = require('jsdom');
const ROOT=path.resolve(__dirname,'..');
const dom=new JSDOM('<div id="root"></div>',{url:'https://fixture.invalid/auth/signup'});
Object.assign(global,{window:dom.window,document:dom.window.document});global.IS_REACT_ACT_ENVIRONMENT=true;
let authState, revision=0, requests=[], navigation=[], root;
const subscribers=new Set();
const auth=Object.assign((select=x=>x)=>{React.useSyncExternalStore(fn=>{subscribers.add(fn);return()=>subscribers.delete(fn)},()=>revision);return select(authState);},{getState:()=>authState,subscribe:fn=>{subscribers.add(fn);return()=>subscribers.delete(fn)}});
const router={replace:p=>navigation.push(p),push:p=>navigation.push(p)};
const session=()=>new Promise((resolve,reject)=>requests.push({resolve,reject}));
const caches=new Map();
function load(relative){const file=path.resolve(ROOT,relative);if(caches.has(file))return caches.get(file);const exports={};caches.set(file,exports);
 const requireModule=name=>{
  if(name==='react'||name==='react/jsx-runtime')return require(name);
  if(name==='solito/navigation'||name==='next/navigation')return {useRouter:()=>router,useSearchParams:()=>new URLSearchParams(window.location.search),usePathname:()=>window.location.pathname};
  if(name.includes('stores/auth-store'))return {useAuthStore:auth};
  if(name.includes('auth-client'))return {getSession:session,authClient:{getSession:session}};
  if(name.startsWith('@dvnt/app/lib/auth/'))return load('packages/app/lib/auth/'+name.split('/').at(-1).replace(/\.ts$/,'')+'.ts');
  if(name.startsWith('./'))return load(path.relative(ROOT,path.resolve(path.dirname(file),name.replace(/\.ts$/,'')+'.ts')));
  throw Error('Unexpected import '+name);
 };
 const code=ts.transpileModule(fs.readFileSync(file,'utf8'),{fileName:file,compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
 vm.runInNewContext(code,{exports,require:requireModule,window,document,URL,URLSearchParams,Date,console,setTimeout,clearTimeout},{filename:file});return exports;
}
const guest=()=>({data:null});
const member=(id='auth-a')=>({data:{user:{id,emailVerified:true},session:{userId:id}}});
const hasForm=()=>!!document.querySelector('[data-signup-fixture]');
async function update(patch){await React.act(async()=>{Object.assign(authState,patch);revision++;for(const fn of subscribers)fn();});}
async function mount(url='/auth/signup',patch={}){if(root)await React.act(async()=>root.unmount());window.sessionStorage.clear();dom.reconfigure({url:'https://fixture.invalid'+url});authState={_hasHydrated:true,isAuthenticated:false,user:null,...patch};requests=[];navigation=[];revision++;root=createRoot(document.getElementById('root'));const C=load('packages/app/components/signup-entry.web.tsx').SignupEntry;await React.act(async()=>root.render(React.createElement(C,null,React.createElement('div',{'data-signup-fixture':'1'},'Fixture signup form'))));}
async function resolve(index,value){await React.act(async()=>requests[index].resolve(value));}
(async()=>{
 await mount('/auth/signup',{_hasHydrated:false});assert.equal(requests.length,0);assert.equal(hasForm(),false,'no signup flash before hydration');
 await update({_hasHydrated:true});assert.equal(requests.length,1);assert.equal(hasForm(),false,'server session pending must not flash signup');
 await resolve(0,guest());assert.equal(hasForm(),true,'verified guest sees signup');
 await update({isAuthenticated:true,user:{id:'new-user',authId:'auth-new'}});assert.equal(hasForm(),true,'new signup store update cannot interrupt verification');assert.deepEqual(navigation,[]);
 for(const progress of ['complete','photo','first_post']){
  await mount('/auth/signup?returnTo=%2Ffeed%2Fevents%2F42%3Fsection%3Dreviews',{isAuthenticated:true,user:{id:'member-a',authId:'auth-a',progress}});
  assert.equal(hasForm(),false);await resolve(0,member());assert.deepEqual(navigation,['/feed'],progress+' member enters feed; normal required gates remain downstream');assert.equal(hasForm(),false);
 }
 await mount('/auth/signup?entry=login&returnTo=%2Ffeed%2Fevents%2F42%3Fsection%3Dreviews');await resolve(0,member());assert.deepEqual(navigation,['/feed/events/42?section=reviews'],'login-to-signup race preserves Rate destination');
 await mount('/auth/signup?entry=login&returnTo=https%3A%2F%2Fevil.invalid');await resolve(0,member());assert.deepEqual(navigation,['/feed'],'unsafe return target ignored');
 await mount('/auth/signup',{isAuthenticated:true,user:{id:'stale',authId:'stale'}});await resolve(0,guest());assert.equal(hasForm(),true,'stale persisted member state cannot fake a server session');assert.deepEqual(navigation,[]);
 await mount();await React.act(async()=>requests[0].reject(new Error('fixture session unavailable')));assert.equal(hasForm(),false,'session error must not expose signup');assert.deepEqual(navigation,[]);
 const retry=[...document.querySelectorAll('button')].find(x=>/retry|try again/i.test(x.textContent));assert.ok(retry,'session error offers retry');await React.act(async()=>retry.click());assert.equal(requests.length,2);await resolve(1,guest());assert.equal(hasForm(),true);
 const continuation=load('packages/app/lib/auth/signup-continuation.ts');
 for(const kind of ['same-unverified','different-account','expired','future','verified']){
  await mount();
  continuation.rememberSignupContinuation(kind==='different-account'?'auth-other':'auth-a');
  window.sessionStorage.setItem('dvnt:signup:verification','pending');
  if(kind==='expired'||kind==='future')window.sessionStorage.setItem('dvnt:signup:continuation',JSON.stringify({authId:'auth-a',savedAt:Date.now()+(kind==='future'?60000:-3600001)}));
  const result=member();result.data.user.emailVerified=kind==='verified';
  await resolve(0,result);
  assert.equal(hasForm(),kind==='same-unverified',kind+' continuation must be account-bound, fresh, and unfinished');
  assert.deepEqual(navigation,kind==='same-unverified'?[]:['/feed']);
 }
 for(const [query,expected] of [
  ['?returnTo=%2Ffeed%2Fevents%2F42%3Fsection%3Dreviews','/auth/verify-email?returnTo=%2Ffeed%2Fevents%2F42%3Fsection%3Dreviews'],
  ['','/auth/verify-email'],
  ['?returnTo=https%3A%2F%2Fevil.invalid','/auth/verify-email'],
 ]){
  await mount('/auth/signup'+query);continuation.rememberSignupContinuation('auth-a');
  const result=member();result.data.user.emailVerified=false;await resolve(0,result);
  assert.equal(hasForm(),false,'completed identity continuation cannot flash initial signup');
  assert.deepEqual(navigation,[expected],'same-account pending email resumes verification with validated destination');
 }
 continuation.clearSignupContinuation();assert.equal(continuation.hasSignupContinuation('auth-a'),false);
 await mount();await resolve(0,{data:null,error:{message:'fixture rejected session'}});assert.equal(hasForm(),false,'server error object stays closed');assert.match(document.body.textContent,/Unable to check/);
 await mount();const stale=requests[0];await update({_hasHydrated:false});await update({_hasHydrated:true});assert.equal(requests.length,2);await React.act(async()=>stale.reject(new Error('old attempt')));assert.equal(hasForm(),false);assert.doesNotMatch(document.body.textContent,/Unable to check/,'stale rejection cannot replace new pending UI');await resolve(1,guest());assert.equal(hasForm(),true);
 await mount();const old=requests[0];await React.act(async()=>root.unmount());root=null;await React.act(async()=>old.resolve(member()));assert.deepEqual(navigation,[],'late result after leaving cannot navigate');
 await mount();await resolve(0,guest());await mount('/auth/signup',{isAuthenticated:true,user:{id:'member-a',authId:'auth-a'}});await resolve(0,member());assert.deepEqual(navigation,['/feed'],'back/remount evaluates current server session anew');
 await React.act(async()=>root.unmount());root=null;console.log('PASS: mounted signup entry hydration, guest latch, member routing, Rate race, stale session, same-account continuation, retry, unmount, remount');
})().catch(error=>{console.error(error);process.exitCode=1;});
