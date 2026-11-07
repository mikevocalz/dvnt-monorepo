// Mount production auth surfaces with fixture IO; no real accounts or network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid/' });
Object.assign(global, { window: dom.window, document: dom.window.document, localStorage: dom.window.localStorage });
global.IS_REACT_ACT_ENVIRONMENT = true;
dom.window.HTMLMediaElement.prototype.play = () => Promise.resolve();
const roomMode = process.env.LYNK_ROOM_TARGET === '1';
const target = roomMode ? '/feed/sneaky-lynk/room/room_123' : process.env.REVIEW_SECTION_TARGET === '1' ? '/feed/events/42?section=reviews' : '/feed/events/42/reviews';
let state, onSubmit, root, mountedComponent, mountedChildren;
const noop = () => {};
const router = { replace: p => state.navigation.push(p), push: p => state.navigation.push(p), back: noop };
const authListeners = new Set();
function setAuth(patch) { Object.assign(state.auth,patch); for (const listener of authListeners) listener(); }
const setUser = user => { state.setUserCalls=(state.setUserCalls||0)+1; setAuth({user,isAuthenticated:!!user,authStatus:user?'authenticated':'unauthenticated'}); };
const auth = (selector = x => x) => selector({ ...state.auth, setUser, updateUser: noop });
auth.getState = () => ({ ...state.auth, setUser });
auth.subscribe = listener => { authListeners.add(listener); return () => authListeners.delete(listener); };
const box = ({children}) => React.createElement('div', null, children);
const button = ({children, onPress, onClick, ...props}) => React.createElement('button', { onClick: onPress || onClick, disabled: props.disabled }, children);
const real = ['lib/auth/signup-continuation', 'lib/auth/return-to', 'lib/auth/review-return', 'lib/auth/guest-event-route', 'lib/auth/room-return', 'lib/auth/continuation-guard', 'lib/auth/session-lifecycle'];
const caches = new Map();
function load(relative) {
  const file = path.resolve(ROOT, relative);
  if (caches.has(file)) return caches.get(file);
  const source = fs.readFileSync(file, 'utf8');
  const exports = {}; caches.set(file, exports);
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const imports = {};
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    const stub = imports[statement.moduleSpecifier.text] = { __esModule: true, default: () => null };
    const named = statement.importClause?.namedBindings;
    if (named && ts.isNamedImports(named)) for (const binding of named.elements) stub[(binding.propertyName || binding.name).text] = /^[A-Z]/.test(binding.name.text) ? () => null : noop;
  }
  const requireModule = name => {
    if (name === 'react' || name === 'react/jsx-runtime' || name === 'zustand') return require(name);
    const match = real.find(s => name.includes(s));
    if (match) return load(`packages/app/${match}.ts`);
    if (name.startsWith('.') && /(?:return-to|room-return|room-links|session-lifecycle|continuation-guard)(?:\.ts)?$/.test(name)) return load(path.relative(ROOT, path.resolve(path.dirname(file), name.replace(/\.ts$/, '')+'.ts')));
    if (name === 'react-native') return { View: box, Text: box, ScrollView: box, Pressable: button, StyleSheet: { create: x => x } };
    if (name.endsWith('/navigation')) return { useRouter: () => router, usePathname: () => state.pathname, useSearchParams: () => new URLSearchParams(window.location.search) };
    if (name.includes('auth-store')) return { useAuthStore: auth };
    if (name.includes('hydrate-auth-profile')) return { hydrateAuthProfile: x => x };
    if (name.includes('auth-client')) return { getSession:async()=>{state.sessionCalls=(state.sessionCalls||0)+1;return state.sessionPromise || state.session || ({data:{session:{},user:{id:'auth-a'}}});}, authClient: {getSession:async()=>state.legacySession || ({data:{user:{email:'member@example.invalid',emailVerified:!state.verifyFailure}}})}, resendVerificationEmail:async()=>({}), submitEmailVerification:async()=>state.verifyPromise || (state.verifyFailure ? {error:{message:'expired'}} : {}), signUp: {email: async args => {state.signup=args; return {data:{user:{id:'auth-a'}}};}}, signIn: { email: async () => { state.passwordCalls=(state.passwordCalls||0)+1; return state.passwordPromise || ({data:{user:{id:'auth-a'}}}); }, social: async args => { state.social = args; return {}; }, magicLink: async args => { state.magic = args; return {}; } }, resumeAuthSession: async () => state.resumePromise || !state.failSession, requestPasswordReset: async () => ({}), submitPasswordReset: async () => state.resetPromise || ({}) };
    if (name.includes('api/privileged')) return { syncAuthUser: async () => {state.profileCalls=(state.profileCalls||0)+1;return state.profilePromise || ({id:'member-a',authId:'auth-a'});}, updateProfile: async () => {} };
    if (name.includes('use-age-verification')) return {useRefreshVerificationStatus:()=>async()=>{state.refreshCalls=(state.refreshCalls||0)+1;},useVerificationState:()=>({data:{state:'not_started'},refetch:async()=>state.refetchPromise || ({data:{state:'approved'}})}),useStartVerification:()=>({isPending:false,mutateAsync:async args=>{state.didit=args;state.diditCalls=(state.diditCalls||0)+1;return state.diditPromise || {status:'passed'};}})};
    if (name.includes('use-media-upload')) return {useMediaUpload:()=>({uploadSingle:async()=>({success:true,url:'https://fixture.invalid/avatar.jpg'})})};
    if (name.includes('utils/age-verification')) return {validateDateOfBirth:()=>({errorMessage:null,isValid:true})};
    if (name.includes('legal/content')) return {TERMS_OF_SERVICE_MD:'Fixture terms',PRIVACY_POLICY_MD:'Fixture privacy'};
    if (name.includes('new-member-progress')) return { fetchNewMemberProgress: async () => state.progressPromise || state.progress };
    if (name.includes('own-identity')) return { fetchOwnIdentity: async () => ({ ok: true, data: {} }), onboardingState: () => 'complete' };
    if (name.includes('use-member-map')) return { useLocationSettings: () => ({}) };
    if (name.includes('location-access-store')) return { useLocationAccessStore: Object.assign(() => ({}), {getState: () => ({})}), locationAllowedFor: () => false };
    if (name.includes('login-ui-store')) return load('packages/app/lib/stores/login-ui-store.ts');
    if (name === '@tanstack/react-form') return { useForm: opts => { onSubmit = opts.onSubmit; return { handleSubmit: noop, getFieldValue: () => 'member@example.invalid' }; } };
    if (name === 'hls.js') return { __esModule:true, default: { isSupported: () => false } };
    if (name.includes('ui/button')) return { Button: button };
    if (name.includes('ui/html')) return { Main: box };
    if (name.includes('web-chrome')) return { routeIsImmersive: () => false, routeOwnsHeader: () => false };
    if (name.includes('events-location-store')) return { useEventsLocationStore: () => ({}) };
    if (name.includes('constants/identity')) return { IDENTITY_OPTIONS: [], AUDIENCE_OPTIONS: [] };
    if (name.includes('AuthScreens.shared')) return {AUTH_PRIMARY_COLOR:'#fff',AUTH_DESTRUCTIVE_COLOR:'#f00',AUTH_SUPPORT_EMAIL:'help@example.invalid'};
    if (name === 'sonner') return { toast: {error:noop,success:noop} };
    return imports[name] || {};
  };
  const compiled = ts.transpileModule(source, { fileName:file, compilerOptions:{ module:ts.ModuleKind.CommonJS, jsx:ts.JsxEmit.ReactJSX, jsxImportSource:'react', target:ts.ScriptTarget.ES2022 } });
  vm.runInNewContext(compiled.outputText, {exports,require:requireModule,window,document,localStorage,console,URL,URLSearchParams,Date,setTimeout:(run,ms)=>setTimeout(run,file.endsWith('web-app-shell.web.tsx')&&ms===10000&&state?.shortSessionTimeout?20:ms),clearTimeout}, {filename:file});
  return exports;
}
async function mount(file, exportName, pathname, options={}) {
  if (root) await React.act(async () => root.unmount());
  dom.reconfigure({ url: 'https://fixture.invalid' + pathname });
  state = { pathname: pathname.split('?')[0], navigation:[], auth:{user:{id:'member-a'},isAuthenticated:true,_hasHydrated:true}, childMounts:0, progress:{step:'complete'}, ...options };
  state.auth.authStatus ??= state.auth.isAuthenticated ? 'authenticated' : 'unauthenticated';
  const C = mountedComponent = options.makeComponent ? options.makeComponent(load(file)) : load(file)[exportName];
  root = createRoot(document.getElementById('root'));
  function ProtectedChild() { React.useEffect(()=>{state.childMounts+=1;},[]); return React.createElement('p',null,'Fixture content'); }
  mountedChildren=React.createElement(ProtectedChild);
  await React.act(async () => { const screen=React.createElement(C, options.componentProps || null, mountedChildren);root.render(options.strict?React.createElement(React.StrictMode,null,screen):screen); });
}
(async () => {
  const shell = 'packages/app/components/web-app-shell.web.tsx';
  await mount(shell, 'WebAppShell', target, {auth:{isAuthenticated:false,_hasHydrated:false}});
  assert.deepEqual(state.navigation, [], 'wait for hydration');
  assert.equal(state.childMounts,0,'protected content never mounts while auth is hydrating');
  if(roomMode){
    await mount(shell,'WebAppShell',target,{auth:{isAuthenticated:true,_hasHydrated:true,authStatus:'loading'}});
    assert.equal(state.childMounts,0,'persisted member cannot mount protected content before session status settles');
    assert.deepEqual(state.navigation,[]);
  }
  await mount(shell, 'WebAppShell', target, {auth:{isAuthenticated:false,_hasHydrated:true}});
  assert.deepEqual(state.navigation, ['/auth/login?returnTo='+encodeURIComponent(target)]);
  assert.equal(state.childMounts,0,'signed-out redirect cannot start room lookups, admission or media');
  await mount(shell, 'WebAppShell', (roomMode || process.env.REVIEW_SECTION_TARGET === '1' ? target : '/public/events/42/reviews'), {auth:{isAuthenticated:false,_hasHydrated:true}});
  assert.deepEqual(state.navigation, ['/auth/login?returnTo='+encodeURIComponent(target)], 'browser email landing is still gated');
  await mount(shell, 'WebAppShell', '/public/events/42/reviews');
  assert.deepEqual(state.navigation, [], 'signed-in browser landing stays on same event review surface');
  await mount(shell, 'WebAppShell', target);
  assert.deepEqual(state.navigation, [], 'signed-in review route remains unchanged');
  assert.equal(state.childMounts,1,'authenticated child may mount behind existing gates');
  await mount(shell,'WebAppShell','/events/public-event',{auth:{isAuthenticated:false,_hasHydrated:true},componentProps:{requireAuth:false}});
  assert.equal(state.childMounts,1,'explicit public event surface remains available');
  assert.deepEqual(state.navigation,[]);
  await mount(shell, 'WebAppShell', '/feed/events/42/organizer', {auth:{isAuthenticated:false,_hasHydrated:true}});
  assert.deepEqual(state.navigation, ['/'], 'management stays gated');
  const loginUrl='/auth/login?returnTo='+encodeURIComponent(target);
  await mount('packages/app/components/web-auth-redirect.web.tsx','RedirectIfAuthed',loginUrl,{componentProps:{to:target}});
  assert.deepEqual(state.navigation,[target], 'profile CTA sends existing members to the review instead of duplicate signup');
  for (const done of [true,false]) {
    localStorage.clear(); if (done) localStorage.setItem('dvnt-welcome-member-a','1');
    await mount('packages/app/features/auth/screens/LoginScreen.web.tsx','LoginScreen',loginUrl);
    await React.act(async () => onSubmit({value:{email:'member@example.invalid',password:'fixture-only'}}));
    assert.deepEqual(state.navigation,[done?target:'/auth/welcome?returnTo='+encodeURIComponent(target)]);
    await mount('apps/web/src/app/(frontend)/auth/social-callback/page.tsx','default','/auth/social-callback?returnTo='+encodeURIComponent(target));
    assert.deepEqual(state.navigation,[done?target:'/auth/welcome?returnTo='+encodeURIComponent(target)]);
  }
  await mount('apps/web/src/app/(frontend)/auth/social-callback/page.tsx','default','/auth/social-callback?error=cancelled&returnTo='+encodeURIComponent(target));
  assert.deepEqual(state.navigation,[loginUrl], 'cancelled social auth retains retry target');
  const welcomeUrl='/auth/welcome?returnTo='+encodeURIComponent(target);
  await mount('packages/app/features/auth/screens/WelcomeScreen.web.tsx','WelcomeScreen',welcomeUrl);
  assert.deepEqual(state.navigation,[target], 'completed profile returns to reviews');
  for (const step of ['photo','first_post']) {
    window.sessionStorage.clear();
    await mount('packages/app/features/auth/screens/WelcomeScreen.web.tsx','WelcomeScreen',welcomeUrl,{progress:{step}});
    assert.deepEqual(state.navigation,[step==='photo'?'/feed/onboarding/photo':'/feed/create']);
    assert.equal(JSON.parse(window.sessionStorage.getItem('dvnt:review-return')).target,target, 'required setup retains intent without bypass');
  }
  const signupUrl='/auth/signup?returnTo='+encodeURIComponent(target);
  await mount('packages/app/features/auth/screens/LoginScreen.web.tsx','LoginScreen',loginUrl);
  const signupLink = [...document.querySelectorAll('button')].find(b=>b.textContent==='Sign up');
  assert.ok(signupLink); await React.act(async()=>signupLink.click());
  assert.deepEqual(state.navigation,[signupUrl+'&entry=login'], 'Rate signup handoff remains distinct from a direct Join invitation');
  await mount('packages/app/features/auth/screens/SignupScreen.web.tsx','SignupScreen',signupUrl);
  await React.act(async () => onSubmit({value:{dateOfBirth:'1990-01-01'}}));
  const terms = [...document.querySelectorAll('button')].find(b=>b.textContent.includes('I agree'));
  assert.ok(terms);
  await React.act(async () => terms.click());
  await React.act(async () => onSubmit({value:{email:'member@example.invalid',password:'fixture-only',username:'member',dateOfBirth:'1990-01-01'}}));
  assert.equal(JSON.parse(window.sessionStorage.getItem('dvnt:signup:continuation')).authId, 'auth-a');
  assert.equal(state.signup.callbackURL,'https://fixture.invalid/auth/verify-email?returnTo='+encodeURIComponent(target));
  const start = [...document.querySelectorAll('button')].find(b=>b.textContent.includes('Start secure'));
  await React.act(async () => start.click());
  assert.equal(state.didit.returnUrl,'https://fixture.invalid'+signupUrl);
  const verifyUrl='/auth/verify-email?token=fixture&returnTo='+encodeURIComponent(target);
  await mount('packages/app/features/auth/screens/VerifyEmailScreen.web.tsx','VerifyEmailScreen',verifyUrl);
  await React.act(async () => new Promise(resolve=>setTimeout(resolve,2050)));
  assert.deepEqual(state.navigation,[target], 'new-tab verification preserves review URL');
  assert.equal(window.sessionStorage.getItem('dvnt:signup:continuation'), null);
  await mount('packages/app/features/auth/screens/VerifyEmailScreen.web.tsx','VerifyEmailScreen',verifyUrl);
  await React.act(async () => root.unmount()); root=null;
  await new Promise(resolve=>setTimeout(resolve,2050));
  assert.deepEqual(state.navigation,[], 'leaving verification cancels delayed navigation');
  window.sessionStorage.setItem('dvnt:review-return',JSON.stringify({userId:'member-a',target,savedAt:Date.now()}));
  await mount('apps/web/src/app/(frontend)/feed/onboarding/photo/page.tsx','default','/feed/onboarding/photo');
  assert.deepEqual(state.navigation,[target], 'server-complete setup consumes correct account return');
  if (roomMode) {
    const rerenderShell = () => React.act(async()=>root.render(React.createElement(mountedComponent,null,mountedChildren)));
    const liveSession = id=>({data:{session:{},user:{id,email:id+'@example.invalid'}}});
    for (const kind of ['guest','same-member','fresh-cookie','different-cookie']) {
      const authState={_hasHydrated:true,isAuthenticated:kind!=='guest'&&kind!=='fresh-cookie',authStatus:'loading',
        user:kind==='same-member'||kind==='different-cookie'?{id:'member-a',authId:'auth-a'}:null};
      let releaseSession;
      await mount(shell,'WebAppShell',target,{auth:authState,sessionPromise:new Promise(r=>{releaseSession=r;}),
        profilePromise:Promise.resolve(kind==='different-cookie'?{id:'member-b',authId:'auth-b'}:{id:'member-a',authId:'auth-a'})});
      assert.equal(state.childMounts,0,kind+' cannot mount before session is checked');
      await React.act(async()=>releaseSession(kind==='guest'?{data:null}:liveSession(kind==='different-cookie'?'auth-b':'auth-a')));
      await rerenderShell();
      if(kind==='guest') {assert.deepEqual(state.navigation,[loginUrl]);assert.equal(state.childMounts,0);}
      else {assert.equal(state.childMounts,1,kind+' session settles without blanking room');assert.equal(state.auth.authStatus,'authenticated');}
      if(kind==='same-member') assert.equal(state.profileCalls||0,0,'proven same-account saved profile need not be recreated');
      if(kind==='different-cookie') assert.equal(state.auth.user.id,'member-b','new cookie cannot inherit old account profile');
      assert.equal(state.sessionCalls,1,'no session read loops after settlement');
    }
    await mount(shell,'WebAppShell',target,{auth:{_hasHydrated:true,isAuthenticated:true,authStatus:'loading',user:{id:'member-a',authId:'auth-a'}},session:{error:{message:'offline'}}});
    assert.equal(state.childMounts,0);assert.match(document.body.textContent,/Unable to confirm/);
    state.session=liveSession('auth-a');
    await React.act(async()=>document.querySelector('button').click());await rerenderShell();
    assert.equal(state.childMounts,1,'failed session read has a working retry');assert.equal(state.sessionCalls,2);
    let releaseSession;
    await mount(shell,'WebAppShell',target,{auth:{_hasHydrated:true,isAuthenticated:true,authStatus:'loading',user:{id:'member-a',authId:'auth-a'}},sessionPromise:new Promise(r=>{releaseSession=r;})});
    await React.act(async()=>{setAuth({user:{id:'member-b',authId:'auth-b'}});setAuth({user:{id:'member-a',authId:'auth-a'}});releaseSession(liveSession('auth-a'));});
    assert.equal(state.setUserCalls||0,0,'stale bootstrap cannot adopt account A-B-A');assert.equal(state.childMounts,0);
    await mount(shell,'WebAppShell',target,{auth:{_hasHydrated:true,isAuthenticated:true,authStatus:'loading',user:{id:'member-a',authId:'auth-a'}},sessionPromise:new Promise(r=>{releaseSession=r;})});
    await React.act(async()=>{load('packages/app/lib/auth/session-lifecycle.ts').publishSessionBoundary({ready:true});releaseSession(liveSession('auth-a'));});
    assert.equal(state.childMounts,0);assert.match(document.body.textContent,/Unable to confirm/,'session-only invalidation offers retry instead of an indefinite blank');
    await mount(shell,'WebAppShell',target,{auth:{_hasHydrated:true,isAuthenticated:false,authStatus:'loading',user:null},session:liveSession('auth-a'),profilePromise:Promise.resolve({id:'member-b',authId:'auth-b'})});
    assert.equal(state.childMounts,0);assert.match(document.body.textContent,/Unable to confirm/,'mismatched profile stays gated');
    await mount(shell,'WebAppShell',target,{auth:{_hasHydrated:true,isAuthenticated:true,authStatus:'loading',user:{id:'old-numeric-row',email:'auth-a@example.invalid'}},session:liveSession('auth-a'),profilePromise:Promise.resolve({id:'new-row',authId:'auth-a'})});
    assert.equal(state.profileCalls,1,'same email without authId must re-sync instead of trusting old account row');
    assert.equal(state.auth.user.id,'new-row');await rerenderShell();assert.equal(state.childMounts,1);
    await mount(shell,'WebAppShell',target,{strict:true,auth:{_hasHydrated:true,isAuthenticated:true,authStatus:'loading',user:{id:'member-a',authId:'auth-a'}},sessionPromise:new Promise(r=>{releaseSession=r;})});
    assert.equal(state.sessionCalls,1,'StrictMode shares a single pending session lookup');
    await React.act(async()=>releaseSession(liveSession('auth-a')));assert.equal(state.setUserCalls,1,'only live StrictMode owner may settle the profile');
    await rerenderShell();assert.equal(state.childMounts,1);
    await mount(shell,'WebAppShell',target,{shortSessionTimeout:true,auth:{_hasHydrated:true,isAuthenticated:false,authStatus:'loading',user:null},sessionPromise:new Promise(r=>{releaseSession=r;})});
    await React.act(async()=>new Promise(r=>setTimeout(r,40)));
    assert.equal(state.childMounts,0);assert.match(document.body.textContent,/Unable to confirm/,'hung session lookup has a bounded retry');
    state.sessionPromise=Promise.resolve({data:null});
    await React.act(async()=>document.querySelector('button').click());await rerenderShell();
    assert.deepEqual(state.navigation,[loginUrl],'retry can settle a guest instead of reusing the timed-out flight');
    await React.act(async()=>releaseSession(liveSession('auth-a')));
    assert.equal(state.auth.isAuthenticated,false,'late timed-out session cannot restore stale authentication');
    const loginFile = 'packages/app/features/auth/screens/LoginScreen.web.tsx';
    await mount(loginFile, 'LoginScreen', loginUrl);
    for (const label of ['Continue with Google', 'Email me a sign-in link']) {
      const button = [...document.querySelectorAll('button')].find(b => b.textContent.trim() === label);
      assert.ok(button); await React.act(async () => button.click());
    }
    assert.equal(state.social.callbackURL, '/auth/social-callback?returnTo=' + encodeURIComponent(target));
    assert.equal(state.social.errorCallbackURL, loginUrl);
    assert.equal(state.magic.callbackURL, 'https://fixture.invalid/auth/social-callback?returnTo=' + encodeURIComponent(target));
    const forgot = [...document.querySelectorAll('button')].find(b => b.textContent.includes('Forgot password'));
    await React.act(async () => forgot.click());
    assert.equal(state.navigation.at(-1), '/auth/forgot-password?returnTo=' + encodeURIComponent(target));
    await mount('packages/app/features/auth/screens/ForgotPasswordScreen.web.tsx', 'ForgotPasswordScreen', '/auth/forgot-password?returnTo=' + encodeURIComponent(target));
    await React.act(async () => onSubmit({value:{email:'member@example.invalid'}}));
    await React.act(async () => [...document.querySelectorAll('button')].find(b=>b.textContent==='Back to sign in').click());
    assert.equal(state.navigation.at(-1), loginUrl);
    await mount('packages/app/features/auth/screens/ResetPasswordScreen.web.tsx', 'ResetPasswordScreen', '/auth/reset-password?token=fixture&returnTo=' + encodeURIComponent(target));
    await React.act(async () => onSubmit({value:{password:'fixture-only',confirmPassword:'fixture-only'}}));
    await React.act(async () => new Promise(r=>setTimeout(r,1850)));
    assert.deepEqual(state.navigation, [loginUrl]);
    await mount('packages/app/features/auth/screens/OnboardingScreen.web.tsx', 'OnboardingScreen', '/auth/onboarding?returnTo=' + encodeURIComponent(target));
    for (const [label, expected] of [['Get started',signupUrl],['Sign in',loginUrl]]) {
      await React.act(async () => [...document.querySelectorAll('button')].find(b=>b.textContent===label).click());
      assert.equal(state.navigation.at(-1),expected);
    }
    await mount('packages/app/components/web-auth-redirect.web.tsx','RedirectIfAuthed', loginUrl, {componentProps:{to:target},session:{data:null}});
    assert.deepEqual(state.navigation, [], 'stale persisted room member remains on login when session expired');
    await mount(shell, 'WebAppShell', target+'?returnTo=%2Ffeed&id=other&next=https://evil.invalid', {auth:{isAuthenticated:false,_hasHydrated:true}});
    assert.deepEqual(state.navigation,[loginUrl], 'incoming query data cannot replace room identity');
    await mount('packages/app/features/auth/screens/VerifyEmailScreen.web.tsx','VerifyEmailScreen',verifyUrl,{verifyFailure:true});
    assert.match(document.body.textContent,/Verification Failed/);
    await React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Back to Login').click());
    assert.deepEqual(state.navigation,[loginUrl], 'expired verification retains exact room for retry');
    let release;
    for (const [file, name, url, deferredKey, result] of [
      [loginFile,'LoginScreen',loginUrl,'passwordPromise',{data:{user:{id:'auth-a'}}}],
      ['apps/web/src/app/(frontend)/auth/social-callback/page.tsx','default','/auth/social-callback?returnTo='+encodeURIComponent(target),'resumePromise',true],
      ['packages/app/features/auth/screens/WelcomeScreen.web.tsx','WelcomeScreen',welcomeUrl,'progressPromise',{step:'photo'}],
      ['packages/app/features/auth/screens/VerifyEmailScreen.web.tsx','VerifyEmailScreen',verifyUrl,'verifyPromise',{}],
    ]) {
      const promise = new Promise(r=>{release=r;});
      await mount(file,name,url,{[deferredKey]:promise});
      let pending;
      if (deferredKey==='passwordPromise') await React.act(async()=>{pending=onSubmit({value:{email:'member@example.invalid',password:'fixture-only'}});});
      await React.act(async()=>root.unmount()); root=null;
      await React.act(async()=>{release(result); await pending;});
      assert.deepEqual(state.navigation,[], name+' completion cannot navigate after leaving');
    }
    await mount('packages/app/features/auth/screens/VerifyEmailScreen.web.tsx','VerifyEmailScreen',verifyUrl);
    dom.reconfigure({url:'https://fixture.invalid/feed/events'});
    await React.act(async()=>new Promise(r=>setTimeout(r,2050)));
    assert.deepEqual(state.navigation,[], 'newer navigation cancels even before verification unmount');
    // The same mounted callback receives a newer room; old async results must
    // not overwrite it, even when the old request resolves last.
    const oldProgress = new Promise(r=>{release=r;});
    await mount('packages/app/features/auth/screens/WelcomeScreen.web.tsx','WelcomeScreen',welcomeUrl,{progressPromise:oldProgress});
    const nextTarget = '/feed/sneaky-lynk/room/newer_room';
    dom.reconfigure({url:'https://fixture.invalid/auth/welcome?returnTo='+encodeURIComponent(nextTarget)});
    state.progressPromise = null;
    await React.act(async()=>root.render(React.createElement(mountedComponent)));
    await React.act(async()=>release({step:'photo'}));
    assert.deepEqual(state.navigation,[nextTarget], 'new room wins over older welcome read');
    await mount('packages/app/features/auth/screens/ResetPasswordScreen.web.tsx','ResetPasswordScreen','/auth/reset-password?returnTo='+encodeURIComponent(target),{legacySession:{data:null}});
    await React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Request a new recovery link').click());
    assert.deepEqual(state.navigation,['/auth/forgot-password?returnTo='+encodeURIComponent(target)],'invalid recovery retry retains the room');
    for (const phase of ['pending','timer']) {
      await mount('packages/app/features/auth/screens/ResetPasswordScreen.web.tsx','ResetPasswordScreen','/auth/reset-password?token=fixture&returnTo='+encodeURIComponent(target),
        phase==='pending'?{resetPromise:new Promise(r=>{release=r;})}:{});
      let pending;
      await React.act(async()=>{pending=onSubmit({value:{password:'fixture-only',confirmPassword:'fixture-only'}});});
      await React.act(async()=>{setAuth({user:{id:'member-b'},isAuthenticated:true});setAuth({user:{id:'member-a'},isAuthenticated:true});if(phase==='pending')release({});await pending;});
      await React.act(async()=>new Promise(r=>setTimeout(r,1850)));
      assert.deepEqual(state.navigation,[],phase+' reset cannot redirect after account A-B-A');
    }
    for (const boundary of ['account-aba','session-aba']) {
      await mount('packages/app/features/auth/screens/WelcomeScreen.web.tsx','WelcomeScreen',welcomeUrl,{progressPromise:new Promise(r=>{release=r;})});
      await React.act(async()=>{
        if(boundary==='account-aba'){setAuth({user:{id:'member-b'},isAuthenticated:true});setAuth({user:{id:'member-a'},isAuthenticated:true});}
        else {const lifecycle=load('packages/app/lib/auth/session-lifecycle.ts');lifecycle.publishSessionBoundary({ready:false});lifecycle.publishSessionBoundary({ready:true});}
        release({step:'photo'});
      });
      assert.deepEqual(state.navigation,[],'welcome cannot retain old room after '+boundary);
    }
    const hookFile = 'packages/app/lib/hooks/use-begin-verification.web.ts';
    const makeComponent = hooks => function VerificationHarness() {
      const flow = hooks.useBeginVerification();
      return React.createElement('button',{onClick:flow.begin},'Start verification');
    };
    window.open = (...args) => { state.openedWindows=(state.openedWindows||[]).concat([args]); };
    await mount(hookFile,null,target+'?returnTo=%2Ffeed&id=wrong',{makeComponent,diditPromise:Promise.resolve({url:'https://verify.fixture.invalid'})});
    await React.act(async()=>document.querySelector('button').click());
    assert.equal(state.didit.returnUrl,'https://fixture.invalid'+target,'hosted ID verification returns only to the room path');
    assert.equal(state.openedWindows.length,1);
    assert.equal(state.refreshCalls,1);
    for (const boundary of ['navigate','unmount','account-aba']) {
      await mount(hookFile,null,target,{makeComponent,diditPromise:new Promise(r=>{release=r;})});
      await React.act(async()=>{document.querySelector('button').click();document.querySelector('button').click();});
      assert.equal(state.diditCalls,1,'repeated ID verify click starts once');
      if (boundary==='navigate') dom.reconfigure({url:'https://fixture.invalid/feed/sneaky-lynk/room/newer'});
      if (boundary==='unmount') {await React.act(async()=>root.unmount());root=null;}
      if (boundary==='account-aba') {setAuth({user:{id:'member-b'},isAuthenticated:true});setAuth({user:{id:'member-a'},isAuthenticated:true});}
      await React.act(async()=>release({url:'https://verify.fixture.invalid'}));
      assert.equal(state.openedWindows?.length||0,0,'late verification cannot open after '+boundary);
      assert.equal(state.refreshCalls||0,0);
    }
    for (const boundary of ['navigate','account-aba','unmount']) {
      window.sessionStorage.setItem('dvnt:signup:verification','pending');
      await mount('packages/app/features/auth/screens/SignupScreen.web.tsx','SignupScreen',signupUrl,{refetchPromise:new Promise(r=>{release=r;})});
      await React.act(async()=>[...document.querySelectorAll('button')].find(b=>b.textContent==='Check verification status').click());
      if (boundary==='navigate') dom.reconfigure({url:'https://fixture.invalid/feed/events'});
      if (boundary==='unmount') {await React.act(async()=>root.unmount());root=null;}
      if (boundary==='account-aba') {setAuth({user:{id:'member-b'},isAuthenticated:true});setAuth({user:{id:'member-a'},isAuthenticated:true});}
      await React.act(async()=>release({data:{state:'approved'}}));
      assert.deepEqual(state.navigation,[],'signup verification cannot revive return after '+boundary);
    }
    window.sessionStorage.removeItem('dvnt:signup:verification');
    for (const destination of ['/feed/events','/auth/login?returnTo='+encodeURIComponent('/feed/sneaky-lynk/room/newest')]) {
      await mount(loginFile,'LoginScreen',loginUrl,{passwordPromise:new Promise(r=>{release=r;})});
      let pending;
      await React.act(async()=>{pending=onSubmit({value:{email:'member@example.invalid',password:'fixture-only'}});});
      dom.reconfigure({url:'https://fixture.invalid'+destination});
      await React.act(async()=>{release({data:{user:{id:'auth-a'}}});await pending;});
      if(destination==='/feed/events') assert.deepEqual(state.navigation,[],'newer navigation wins even before login unmount');
      else assert.ok(state.navigation.at(-1)?.includes(encodeURIComponent('/feed/sneaky-lynk/room/newest')) || state.navigation.at(-1)==='/feed/sneaky-lynk/room/newest','new room query wins in same mounted login');
    }
    const loginStore = load('packages/app/lib/stores/login-ui-store.ts').useLoginUiStore;
    const lifecycle = load('packages/app/lib/auth/session-lifecycle.ts');
    let oldResolve, newResolve, oldSubmit, newSubmit;
    await mount(loginFile,'LoginScreen',loginUrl,{passwordPromise:new Promise(r=>{oldResolve=r;})});
    await React.act(async()=>{oldSubmit=onSubmit({value:{email:'first@example.invalid',password:'fixture-only'}});});
    await React.act(async()=>{void onSubmit({value:{email:'first@example.invalid',password:'fixture-only'}});});
    assert.equal(state.passwordCalls,1,'repeated submit starts only one sign-in');
    assert.equal(loginStore.getState().isSubmitting,true);
    await mount(loginFile,'LoginScreen',loginUrl,{passwordPromise:new Promise(r=>{newResolve=r;})});
    assert.equal(loginStore.getState().isSubmitting,false,'unmount releases the abandoned owner before remount');
    await React.act(async()=>{newSubmit=onSubmit({value:{email:'new@example.invalid',password:'fixture-only'}});});
    await React.act(async()=>{oldResolve({data:{user:{id:'auth-a'}}});await oldSubmit;});
    assert.equal(loginStore.getState().isSubmitting,true,'old completion cannot unlock the new submission');
    assert.deepEqual(state.navigation,[]);
    await React.act(async()=>{newResolve({data:{user:{id:'auth-a'}}});await newSubmit;});
    assert.equal(loginStore.getState().isSubmitting,false);
    assert.equal(state.navigation.length,1);
    for (const phase of ['pending','timer']) {
      for (const boundary of ['logout','account-aba','session-aba']) {
        await mount('packages/app/features/auth/screens/VerifyEmailScreen.web.tsx','VerifyEmailScreen',verifyUrl,
          phase==='pending'?{verifyPromise:new Promise(r=>{release=r;})}:{});
        await React.act(async()=>{
          if (boundary==='logout') setAuth({user:null,isAuthenticated:false});
          if (boundary==='account-aba') { setAuth({user:{id:'member-b'},isAuthenticated:true});setAuth({user:{id:'member-a'},isAuthenticated:true}); }
          if (boundary==='session-aba') { lifecycle.publishSessionBoundary({ready:false});lifecycle.publishSessionBoundary({ready:true}); }
          if (phase==='pending') release({});
        });
        await React.act(async()=>new Promise(r=>setTimeout(r,2050)));
        assert.deepEqual(state.navigation,[],phase+' verification never resumes room after '+boundary);
      }
    }
    for (const kind of ['social','password']) {
      await mount(kind==='social'?'apps/web/src/app/(frontend)/auth/social-callback/page.tsx':loginFile,
        kind==='social'?'default':'LoginScreen',kind==='social'?'/auth/social-callback?returnTo='+encodeURIComponent(target):loginUrl,
        {profilePromise:new Promise(r=>{release=r;})});
      let pending;
      if(kind==='password') await React.act(async()=>{pending=onSubmit({value:{email:'member@example.invalid',password:'fixture-only'}});});
      await React.act(async()=>{setAuth({user:{id:'member-b'},isAuthenticated:true});setAuth({user:{id:'member-a',name:'newer session'},isAuthenticated:true});release({id:'member-a',name:'stale response'});await pending;});
      assert.deepEqual(state.navigation,[],kind+' old profile result cannot navigate after account A-B-A');
      assert.equal(state.auth.user.name,'newer session',kind+' old result cannot overwrite the new profile');
      assert.equal(state.setUserCalls||0,0);
    }

  }
  await React.act(async () => root.unmount());
  console.log('PASS: mounted shell, password/OAuth login, cancellation retry, first-browser welcome, signup/ID/email verification, cancelled navigation, and required-setup handoff');
})().catch(error=>{console.error(error);process.exitCode=1});
