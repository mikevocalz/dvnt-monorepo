// Execute the real native parser, intent handler, store, replay and verification
// callback. Router/browser/auth-service boundaries are synthetic, not device QA.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { create } = require('zustand');
const root = path.resolve(__dirname, '..');
const timers = new Set();
const schedule = fn => { timers.add(fn); return fn; };
const cancel = fn => timers.delete(fn);
async function flush() {
  const batch = [...timers]; timers.clear();
  for (const timer of batch) await timer();
}
function load(file, mocks = {}, dev = false) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } });
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', 'setTimeout', 'clearTimeout', '__DEV__', compiled.outputText)(name => {
    if (name in mocks) return mocks[name];
    throw Error('Unexpected import ' + name + ' in ' + file);
  }, mod, mod.exports, schedule, cancel, dev);
  return mod.exports;
}
const roomHelpers = load('packages/app/features/sneaky-lynk/room-links.ts');
const registry = load('packages/app/lib/deep-linking/route-registry.ts', {
  '@dvnt/app/features/sneaky-lynk/room-links': roomHelpers, zod: require('zod'), '@dvnt/app/lib/branding/lynk-branding': { getLynkDisplayName: () => 'Lynk' },
});
const { useDeepLinkStore: links } = load('packages/app/lib/stores/deep-link-store.ts', { zustand: { create } });
const auth = create(() => ({ user: null, isAuthenticated: false, authStatus: 'unauthenticated', _hasHydrated: true }));
const navigations = [];
const router = { push: target => navigations.push(['push', target]), replace: target => navigations.push(['replace', target]) };
const mocks = { '@dvnt/app/features/sneaky-lynk/room-links': roomHelpers, 'expo-router': { router }, '@dvnt/app/lib/stores/auth-store': { useAuthStore: auth },
  '@dvnt/app/lib/stores/deep-link-store': { useDeepLinkStore: links }, './route-registry': registry };
const engine = load('packages/app/lib/deep-linking/link-engine.ts', mocks);
const { redirectSystemPath: intent } = load('packages/app/features/routes/screens/+native-intent.tsx', {
  '@dvnt/app/lib/deep-linking/link-engine': engine, '@dvnt/app/lib/stores/deep-link-store': { useDeepLinkStore: links },
});
const roomPath = id => '/(protected)/sneaky-lynk/room/' + id;
const url = id => 'https://dvntapp.live/sneaky-lynk/room/' + id;
function account(id, status = 'authenticated') {
  auth.setState({ user: id ? { id, authId: 'auth-' + id } : null, isAuthenticated: !!id, authStatus: status });
}
function reset() {
  timers.clear(); navigations.length = 0;
  links.setState({ pendingLink: null, pendingAccountKey: null, pendingOnboarding: false, lastHandledUrl: null, lastHandledAt: 0 });
}
(async () => {
  for (const prefix of ['/sneaky-lynk/room/', '/sneaky-lynk/', '/feed/sneaky-lynk/room/', '/feed/sneaky-lynk/', '/sl/', '/sneaky/']) {
    for (const origin of ['https://dvntapp.live', 'https://www.dvntapp.live', 'dvnt:/', '']) {
      const parsed = engine.parseIncomingUrl(origin + prefix + 'room_123-A?id=other&camera=on&anonymous=1&hasVideo=0&title=Fake&dataUrl=ignored&url=expo-development-client/?url=ignored#part');
      assert.equal(parsed.routerPath, roomPath('room_123-A'));
      assert.equal(parsed.requiresAuth, true);
      assert.deepEqual(parsed.params, { id: 'room_123-A' }, 'only path identity survives shared links');
    }
  }
  assert.equal(engine.parseIncomingUrl(url('%72oom-A')).params.id, 'room-A', 'decode one ID segment');
  for (const target of ['https://dvntapp.live/sneaky-lynk//room/actual?i=evil', 'https://dvntapp.live/sl//actual?i=evil']) {
    assert.equal(engine.parseIncomingUrl(target), null, 'repeated separators cannot smuggle query interpolation');
  }
  assert.equal(registry.buildRouterPath('/room/:id', { i: 'evil', id: 'actual' }), '/room/actual', 'whole placeholder substitution');
  for (const id of ['%252f', 'abc%2fdef', 'abc%5cdef', 'abc%3fdef', 'abc%23def', '%00', 'room%0a', 'room%0d', '%', '..', '%2e%2e', 'x/../y', 'my-room', 'space-fixture', 'a'.repeat(129)]) {
    assert.equal(engine.parseIncomingUrl(url(id)), null, 'reject unsafe/local ID ' + id);
  }
  for (const target of ['https://expo.evil.test/sl/a', 'https://evil-localhost.test/sl/a', 'https://dvntapp.live.evil.test/sl/a', 'http://dvntapp.live/sl/a', 'https://user@dvntapp.live/sl/a', 'https://dvntapp.live:444/sl/a', 'javascript:/sl/a', '//evil.test/sl/a', 'https://localhost/sl/a', 'exp://127.0.0.1:8081/--/sl/a']) {
    assert.equal(engine.parseIncomingUrl(target), null, target);
  }
  const dev = load('packages/app/lib/deep-linking/link-engine.ts', mocks, true);
  for (const target of ['http://localhost:8081/sl/a', 'http://127.0.0.1:8081/sl/a', 'https://fixture.exp.direct/sl/a', 'https://fixture.expo.dev/sl/a', 'exp://192.168.1.5:8081/--/sl/a']) {
    assert.equal(dev.parseIncomingUrl(target).routerPath, roomPath('a'), 'explicit dev transport survives');
  }
  assert.equal(dev.parseIncomingUrl('dvnt://expo-development-client/?url=http://localhost'), null);
  const diagnostics = []; const originalLog = console.log; const originalError = console.error;
  console.log = (...args) => diagnostics.push(args); console.error = (...args) => diagnostics.push(args);
  try {
    reset(); account(null); intent({ path: url('callback-room'), initial: true });
    for (const [alias, screen] of [['/auth/verify', 'verify-email'], ['/auth/verify-email', 'verify-email'], ['/verify-email', 'verify-email'], ['/auth/reset', 'reset-password'], ['/auth/reset-password', 'reset-password'], ['/reset-password', 'reset-password']]) {
      assert.equal(intent({ path: 'dvnt:/' + alias, initial: false }), '/(auth)/' + screen);
      const callback = 'dvnt:/' + alias + '?token=secret%3Dvalue%2Bencoded&callbackURL=https%3A%2F%2Fevil.example&error=expired';
      const parsed = engine.parseIncomingUrl(callback);
      assert.equal(parsed.requiresAuth, false);
      assert.deepEqual(parsed.params, { token: 'secret=value+encoded', error: 'expired' });
      assert.equal(intent({ path: callback, initial: false }), '/(auth)/' + screen + '?token=secret%3Dvalue%2Bencoded&error=expired');
      assert.equal(links.getState().pendingLink.params.id, 'callback-room', 'verification and recovery retain room');
      links.setState({ lastHandledUrl: null, lastHandledAt: 0 });
      engine.handleDeepLink(callback);
      const replacement = navigations.at(-1);
      assert.equal(replacement[0], 'replace');
      assert.equal(replacement[1].pathname, '/(auth)/' + screen);
      assert.equal(replacement[1].params.token, 'secret=value+encoded');
    }
    for (const token of ['newer-first', 'newer-second']) {
      engine.handleDeepLink('dvnt://auth/reset?token=' + token);
      assert.equal(navigations.at(-1)[1].params.token, token, 'distinct newer auth token is not a duplicate pathname');
    }
  } finally { console.log = originalLog; console.error = originalError; }
  assert.doesNotMatch(JSON.stringify(diagnostics), /secret|encoded|evil\.example/, 'routing diagnostics never expose auth query values');
  console.log('PASS native exact-room aliases, decoded IDs, dropped untrusted query, local-room exclusion, strict hosts and supported development links');

  reset(); account(null);
  assert.equal(intent({ path: 'dvnt://dataUrl=dvntShareKey#text', initial: true }), '/');
  assert.equal(links.getState().openedFromShareIntent, true);
  assert.equal(intent({ path: url('query-room') + '?dataUrl=ignored', initial: true }), '/(auth)/login');
  assert.equal(links.getState().pendingLink.params.id, 'query-room', 'query cannot masquerade as a native share extension');
  reset();
  assert.equal(intent({ path: url('cold'), initial: true }), '/(auth)/login');
  assert.equal(links.getState().pendingLink.params.id, 'cold');
  assert.equal(intent({ path: url('cold'), initial: false }), '/(auth)/login', 'duplicate must not send guest to feed');
  account('alice');
  assert.equal(links.getState().pendingAccountKey, 'auth-alice');
  engine.replayPendingLink(); engine.replayPendingLink();
  await flush();
  assert.deepEqual(navigations, [['push', { pathname: roomPath('cold'), params: { id: 'cold' } }]], 'one owner consumes only at successful dispatch');
  assert.equal(links.getState().pendingLink, null);
  assert.equal(intent({ path: url('cold'), initial: false }), roomPath('cold'), 'duplicate must retain the room, never /');

  reset(); account('alice'); auth.setState({ _hasHydrated: false });
  assert.equal(intent({ path: url('unhydrated'), initial: true }), '/(auth)/login', 'persisted auth cannot mount a room before hydration');
  engine.replayPendingLink(); await flush(); assert.equal(navigations.length, 0);
  auth.setState({ _hasHydrated: true }); engine.replayPendingLink(); await flush();
  assert.equal(navigations[0][1].pathname, roomPath('unhydrated'));

  reset(); account('alice', 'loading');
  assert.equal(intent({ path: url('bootstrap'), initial: true }), '/(auth)/login');
  engine.replayPendingLink(); await flush(); assert.equal(navigations.length, 0);
  account('alice'); engine.replayPendingLink(); await flush();
  assert.equal(navigations[0][1].pathname, roomPath('bootstrap'));

  reset(); account(null); intent({ path: url('old'), initial: true }); account('alice');
  engine.replayPendingLink();
  assert.equal(intent({ path: url('new'), initial: false }), roomPath('new'));
  await flush(); assert.equal(navigations.length, 0, 'older scheduled callback cannot displace a newer warm link');
  engine.replayPendingLink({ currentPath: '/sneaky-lynk/room/new' }); await flush();
  assert.equal(navigations.length, 0, 'already-open destination consumes without another push');
  assert.equal(links.getState().pendingLink, null);

  reset(); intent({ path: url('async-old'), initial: false });
  let resolveProgress;
  engine.replayPendingLink({ canReplay: () => new Promise(resolve => { resolveProgress = resolve; }) });
  const readingProgress = flush();
  intent({ path: url('async-new'), initial: false });
  resolveProgress(true); await readingProgress;
  assert.equal(navigations.length, 0, 'a newer room during the gate request invalidates its old completion');
  assert.equal(links.getState().pendingLink.params.id, 'async-new');

  reset(); intent({ path: url('arrived'), initial: false });
  let gateRead = false;
  engine.replayPendingLink({ currentPath: '/sneaky-lynk/room/arrived', canReplay: async () => { gateRead = true; return true; } });
  assert.equal(links.getState().pendingLink, null, 'exact room arrival finishes pending navigation immediately');
  assert.equal(gateRead, false, 'arrival cannot leave a slow progress callback that hijacks Back to feed');
  engine.replayPendingLink({ currentPath: '/' }); await flush();
  assert.equal(navigations.length, 0);
  const detour = engine.parseIncomingUrl(url('setup-detour'));
  links.getState().setPendingLink(detour, 'auth-alice', true);
  engine.replayPendingLink({ currentPath: '/sneaky-lynk/room/setup-detour', canReplay: async () => false }); await flush();
  assert.equal(links.getState().pendingLink, detour, 'an actual onboarding redirect retains continuation until completed');
  engine.replayPendingLink({ currentPath: '/', canReplay: async () => true }); await flush();
  assert.equal(navigations.at(-1)[1].pathname, roomPath('setup-detour'));

  reset(); intent({ path: url('onboarding'), initial: false });
  engine.replayPendingLink({ canReplay: async () => false }); await flush();
  assert.equal(links.getState().pendingLink.params.id, 'onboarding', 'mandatory onboarding retains the exact destination');
  engine.replayPendingLink({ canReplay: async () => { throw Error('offline'); } }); await flush();
  assert.ok(links.getState().pendingLink, 'unknown gate read never silently loses the room');
  engine.replayPendingLink({ canReplay: async () => true }); await flush();
  assert.equal(navigations.at(-1)[1].pathname, roomPath('onboarding'));

  reset(); intent({ path: url('account'), initial: false }); engine.replayPendingLink();
  account('bob'); account('alice'); await flush();
  assert.equal(navigations.length, 0); assert.equal(links.getState().pendingLink, null, 'A-B-A cannot revive old intent');
  intent({ path: url('logout'), initial: false }); engine.replayPendingLink(); account(null); await flush();
  assert.equal(navigations.length, 0); assert.equal(links.getState().pendingLink, null);
  account('alice'); intent({ path: url('cancelled'), initial: false }); const cleanup = engine.replayPendingLink(); cleanup(); await flush();
  assert.equal(navigations.length, 0, 'effect cleanup cancels delayed navigation');
  reset(); intent({ path: url('superseded'), initial: false }); engine.replayPendingLink();
  intent({ path: 'dvnt://events/42', initial: false }); await flush();
  assert.equal(navigations.length, 0); assert.equal(links.getState().pendingLink, null, 'newer non-room destination also supersedes');
  for (const publicUrl of ['dvnt://u/MixedCase', 'dvnt://e/42', 'dvnt://search']) {
    for (const dispatch of [target => intent({ path: target, initial: false }), engine.handleDeepLink]) {
      reset(); account(null); intent({ path: url('guest-pending'), initial: false });
      const publicDestination = dispatch(publicUrl);
      if (publicDestination) assert.equal(intent({ path: publicUrl, initial: false }), publicDestination, 'duplicate public URL never becomes login');
      assert.equal(links.getState().pendingLink, null, 'newer guest public content clears old room: ' + publicUrl);
      account('alice'); engine.replayPendingLink(); await flush();
      assert.ok(!navigations.some(([, target]) => JSON.stringify(target).includes('guest-pending')));
    }
  }
  reset(); account(null); intent({ path: url('auth-resume'), initial: false });
  intent({ path: 'dvnt://login', initial: false });
  assert.equal(links.getState().pendingLink.params.id, 'auth-resume', 'auth transition retains room');
  account('alice');

  console.log('PASS actual native cold/warm intents, bootstrap, one-shot deferred login replay, duplicate events, newer destination, onboarding hold/retry and logout/account/cleanup races');

  const rootSource = fs.readFileSync(path.join(root, 'packages/app/features/routes/screens/_layout.tsx'), 'utf8');
  const rootAst = ts.createSourceFile('root.tsx', rootSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let replayEffect;
  function visit(node) {
    if (ts.isCallExpression(node) && node.expression.getText(rootAst) === 'useEffect' && node.arguments[0]?.getText(rootAst).includes('return replayPendingLink(')) replayEffect = node.arguments[0];
    ts.forEachChild(node, visit);
  }
  visit(rootAst); assert.ok(replayEffect);
  const effectText = ts.transpileModule('(' + replayEffect.getText(rootAst) + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, '');
  let gate = 'photo'; const captured = [];
  const scope = { splashAnimationFinished: true, authSettled: true, isAuthenticated: true, pendingDeepLink: engine.parseIncomingUrl(url('protected')), segments: ['(protected)', 'edit-profile'], pathname: '/edit-profile',
    deepLinkReplayOrigin: { current: null }, useDeepLinkStore: links, replayPendingLink: options => { captured.push(options); return () => {}; }, isLynkRoomLink: engine.isLynkRoomLink, fetchNewMemberProgress: async () => ({ step: gate }) };
  const actualEffect = overrides => { const values = { ...scope, ...overrides }; return new Function(...Object.keys(values), 'return ' + effectText)(...Object.values(values))(); };
  actualEffect(); const canReplay = captured[0].canReplay;
  const parsed = engine.parseIncomingUrl(url('protected'));
  links.getState().setPendingLink(parsed, 'auth-alice');
  assert.equal(await canReplay(parsed), true, 'ordinary sign-in return lands prejoin without waiting for a separate progress request');
  links.getState().setPendingLink(parsed, 'auth-alice', true);
  for (gate of ['photo', 'first_post']) assert.equal(await canReplay(parsed), false);
  for (gate of ['not_required', 'complete', 'pending_verification']) assert.equal(await canReplay(parsed), true, 'prejoin remains accessible; admission is still independently guarded');
  for (const segment of ['signup', 'verify-email', 'reset-password']) actualEffect({ segments: ['(auth)', segment] });
  actualEffect({ authSettled: false }); actualEffect({ isAuthenticated: false });
  assert.equal(captured.length, 1, 'auth/verification is never interrupted by queued link');
  links.getState().setPendingLink(scope.pendingDeepLink, 'auth-alice');
  actualEffect({ pathname: '/messages', segments: ['(protected)', 'messages'] });
  assert.equal(links.getState().pendingLink, null, 'Back to Lynks cancels a pending slow room replay');
  assert.equal(captured.length, 1, 'manual newer destination does not schedule another replay');
  assert.match(rootSource, /pendingDeepLink, pathname, segments/);
  assert.doesNotMatch(fs.readFileSync(path.join(root, 'packages/app/features/routes/screens/(auth)/login.tsx'), 'utf8'), /replayPendingLink\(/, 'login must not compete with root replay');
  console.log('PASS actual root replay effect respects mandatory profile steps and signup/email/reset screens');

  const protectedSource = fs.readFileSync(path.join(root, 'packages/app/features/routes/screens/(protected)/_layout.tsx'), 'utf8');
  const protectedAst = ts.createSourceFile('protected.tsx', protectedSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let progressEffect;
  function findProgress(node) {
    if (ts.isCallExpression(node) && node.expression.getText(protectedAst) === 'useEffect' && node.arguments[0]?.getText(protectedAst).includes('fetchNewMemberProgress().then')) progressEffect = node.arguments[0];
    ts.forEachChild(node, findProgress);
  }
  findProgress(protectedAst); assert.ok(progressEffect);
  const progressText = ts.transpileModule('(' + progressEffect.getText(protectedAst) + ')', { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, '');
  let resolveGate; const detourRoutes = [];
  const progressScope = { memberAccountKey: 'auth-alice', memberPath: '/sneaky-lynk/room/gated-room', memberRouter: { replace: target => detourRoutes.push(target) },
    fetchNewMemberProgress: () => new Promise(resolve => { resolveGate = resolve; }), deepLinkAccountKey: engine.deepLinkAccountKey, useAuthStore: auth,
    parseIncomingUrl: engine.parseIncomingUrl, isLynkRoomLink: engine.isLynkRoomLink, useDeepLinkStore: links };
  const runProgress = () => new Function(...Object.keys(progressScope), 'return ' + progressText)(...Object.values(progressScope))();
  reset(); account('alice'); let cleanupProgress = runProgress();
  resolveGate({ step: 'photo' }); await Promise.resolve();
  assert.equal(links.getState().pendingLink.params.id, 'gated-room'); assert.equal(links.getState().pendingOnboarding, true);
  assert.deepEqual(detourRoutes, ['/(protected)/edit-profile']); cleanupProgress();
  reset(); detourRoutes.length = 0; cleanupProgress = runProgress();
  account('bob'); account('alice'); resolveGate({ step: 'first_post' }); await Promise.resolve();
  assert.equal(links.getState().pendingLink, null); assert.deepEqual(detourRoutes, [], 'old account progress cannot recreate cleared room intent'); cleanupProgress();
  reset(); cleanupProgress = runProgress(); cleanupProgress(); resolveGate({ step: 'photo' }); await Promise.resolve();
  assert.equal(links.getState().pendingLink, null, 'Back during a progress read cannot recreate room continuation');
  console.log('PASS actual protected onboarding effect preserves exact room only for required detours, invalidates account epochs and Back/unmount');

  const aasa = load('apps/web/src/app/.well-known/apple-app-site-association/route.ts', { 'next/server': { NextResponse: { json: data => data } } }).GET();
  const components = aasa.applinks.details.flatMap(detail => detail.components);
  const claimed = pathname => { const first=components.find(component=>new RegExp('^'+component['/'].replaceAll('*','.*')+'$').test(pathname));return !!first&&!first.exclude; };
  for (const p of ['/sneaky-lynk/room/room-id', '/sneaky-lynk/room-id', '/sl/room-id', '/sneaky/room-id', '/feed/sneaky-lynk/room/room-id', '/feed/sneaky-lynk/room-id']) assert.ok(claimed(p), p);
  assert.ok(!claimed('/public/events/42/reviews'), 'keep browser-only review email landing');
  for(const p of ['/sneaky-lynk/create','/sneaky-lynk/billing','/sneaky-lynk/room','/sneaky/success','/sneaky/cancel']){assert.equal(claimed(p),false,'room aliases do not intercept unrelated web flow');assert.equal(claimed(p+'/'),false);}
  console.log('PASS repository AASA claims all supported Lynk URL spellings; physical OS association remains untested');

  let callbackResolve; const requests = [], browser = [], refreshes = [], effectCleanup = [];
  const fakeReact = { useState: () => [false, () => {}], useRef: value => ({ current: value }), useEffect: callback => effectCleanup.push(callback()) };
  const hook = load('packages/app/lib/hooks/use-begin-verification.ts', {
    react: fakeReact, 'expo-router': { usePathname: () => '/sneaky-lynk/room/verified-room' },
    'expo-web-browser': { openBrowserAsync: async target => browser.push(target) },
    '@dvnt/app/lib/stores/auth-store': { useAuthStore: auth }, '@dvnt/app/lib/deep-linking/link-engine': engine,
    '@dvnt/app/features/sneaky-lynk/room-links': roomHelpers,
    '@dvnt/app/lib/hooks/use-age-verification': { useStartVerification: () => ({ mutateAsync: args => { requests.push(args); return new Promise(resolve => { callbackResolve = resolve; }); } }), useRefreshVerificationStatus: () => () => refreshes.push(true) },
    '@dvnt/observability/flows': { onboardingCheckpoint() {} },
  }).useBeginVerification();
  let operation = hook.begin();
  assert.deepEqual(requests[0], { returnUrl: 'dvnt://sneaky-lynk/room/verified-room' });
  callbackResolve({ url: 'https://provider.example/verification' }); await operation;
  assert.equal(browser.length, 1); assert.equal(refreshes.length, 1);
  operation = hook.begin(); account('bob'); account('alice'); callbackResolve({ url: 'https://provider.example/stale' }); await operation;
  assert.equal(browser.length, 1, 'stale verification startup cannot open for a changed account');
  operation = hook.begin(); effectCleanup.forEach(cleanup => cleanup()); callbackResolve({ url: 'https://provider.example/stale' }); await operation;
  assert.equal(browser.length, 1, 'unmounted verification startup cannot launch');
  console.log('PASS native verification uses exact room callback and ignores delayed account/unmount results; no synthetic provider approval or auto-admission');
})().catch(error => { console.error(error); process.exitCode = 1; });
