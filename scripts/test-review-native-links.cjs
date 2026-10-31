const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
function load(file, mocks) {
  const mod = new Module(path.join(root,file), module);
  mod.require = name => { if (name in mocks) return mocks[name]; throw Error('Unexpected import '+name); };
  mod._compile(ts.transpileModule(fs.readFileSync(path.join(root,file),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,file);
  return mod.exports;
}
const registry = load('packages/app/lib/deep-linking/route-registry.ts', {zod:require('zod'),'@dvnt/app/lib/branding/lynk-branding':{getLynkDisplayName:()=> 'Lynk'}});
const engine = load('packages/app/lib/deep-linking/link-engine.ts', {'expo-router':{router:{}},'@dvnt/app/lib/stores/auth-store':{useAuthStore:{}},'@dvnt/app/lib/stores/deep-link-store':{useDeepLinkStore:{}},'./route-registry':registry});
for (const url of ['https://dvntapp.live/feed/events/42/reviews?id=99', 'dvnt://events/42/reviews?id=99']) {
  const parsed = engine.parseIncomingUrl(url);
  assert.equal(parsed.requiresAuth, true);
  assert.equal(parsed.routerPath, '/(protected)/events/42/reviews');
  assert.equal(parsed.params.id, '42');
  const target = engine.resolveNavigationTarget(parsed);
  assert.equal(target.path, '/(protected)/events/42/reviews');
  assert.equal(target.params.id, '42');
}
for (const id of ['0','-1','01','1.5','9007199254740992','%34%32']) {
  assert.equal(registry.matchRoute(`/events/${id}/reviews`), null);
}
const aasa = load('apps/web/src/app/.well-known/apple-app-site-association/route.ts', {'next/server':{NextResponse:{json:data=>data}}}).GET();
for (const entry of aasa.applinks.details.flatMap(d=>d.components)) {
  const regex = new RegExp('^' + entry['/'].replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*') + '$');
  assert.equal(regex.test('/public/events/42/reviews'), false, 'email landing must stay outside installed-app claims');
}
console.log('PASS: authenticated native review mappings, path-ID precedence, invalid IDs, browser-only email landing');
