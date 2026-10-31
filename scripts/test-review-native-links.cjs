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
for (const url of ['https://dvntapp.live/feed/events/42/reviews?id=99', 'dvnt://events/42/reviews?id=99', 'https://dvntapp.live/public/events/42/reviews?id=99']) {
  const parsed = engine.parseIncomingUrl(url);
  assert.equal(parsed.requiresAuth, true);
  assert.equal(parsed.routerPath, '/(protected)/events/42/reviews');
  assert.equal(parsed.params.id, '42');
  const target = engine.resolveNavigationTarget(parsed);
  assert.equal(target.path, '/(protected)/events/42/reviews');
  assert.equal(target.params.id, '42');
}
for (const id of ['0','-1','01','1.5','9007199254740992','%34%32']) {
  for (const prefix of ['/events', '/feed/events', '/public/events']) {
    assert.equal(registry.matchRoute(`${prefix}/${id}/reviews`), null);
  }
}
const aasa = load('apps/web/src/app/.well-known/apple-app-site-association/route.ts', {'next/server':{NextResponse:{json:data=>data}}}).GET();
for (const entry of aasa.applinks.details.flatMap(d=>d.components)) {
  const regex = new RegExp('^' + entry['/'].replace(/[.+?^${}()|[\]\\]/g,'\\$&').replace(/\*/g,'.*') + '$');
  assert.equal(regex.test('/public/events/42/reviews'), false, 'email landing must stay outside iOS installed-app claims');
}
console.log('PASS: authenticated native review mappings, path-ID precedence, invalid IDs, iOS browser email landing');

for (const prefix of ['/public/events', '/feed/events']) {
  const parsed = engine.parseIncomingUrl(`https://dvntapp.live${prefix}/42?section=reviews&id=99`);
  assert.equal(parsed.routerPath, '/(protected)/events/42');
  assert.equal(parsed.params.id, '42');
  assert.equal(parsed.params.section, 'reviews');
  assert.equal(parsed.requiresAuth, true);
  const target = engine.resolveNavigationTarget(parsed);
  assert.equal(target.path, '/(protected)/events/42');
  assert.equal(target.params.section, 'reviews');
  for (const id of ['0', '-1', '01', '1.5', '9007199254740992', '%34%32']) {
    assert.equal(registry.matchRoute(`${prefix}/${id}`), null);
  }
}
console.log('PASS: event-details review section email aliases preserve section and authoritative path ID');

// Exercise the actual native section callback without loading device-only modules.
const nativeSource = fs.readFileSync(path.join(root, 'packages/app/features/routes/screens/(protected)/events/[id]/index.tsx'), 'utf8');
const nativeAst = ts.createSourceFile('detail.tsx', nativeSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let scrollCallback;
function findScroll(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(nativeAst) === 'scrollToRequestedSection') {
    scrollCallback = node.initializer.arguments[0].getText(nativeAst);
  }
  ts.forEachChild(node, findScroll);
}
findScroll(nativeAst);
assert.ok(scrollCallback, 'native details must implement section scrolling');
const calls = [];
const layout = { current: { eventId: '42', handled: false } };
const scrollRef = { current: { scrollTo: value => calls.push(value) } };
const callback = new Function('sectionLayout', 'requestedSection', 'eventId', 'insets', 'detailsScrollRef', `return (${scrollCallback})`);
const scroll = callback(layout, 'reviews', '42', {top:20}, scrollRef);
scroll(); assert.equal(calls.length, 0, 'wait for content and review layout');
layout.current.contentY = 300;
scroll(); assert.equal(calls.length, 0, 'wait for review layout');
layout.current.reviewsY = 1200;
scroll(); assert.deepEqual(calls, [{y:1416, animated:false}]);
scroll(); assert.equal(calls.length, 1, 'do not hijack subsequent manual scrolling');
layout.current.handled = false;
callback(layout, null, '42', {top:20}, scrollRef)();
callback(layout, 'reviews', '85', {top:20}, scrollRef)();
assert.equal(calls.length, 1, 'ordinary links and stale event layouts must not scroll');
layout.current.contentY = 0; layout.current.reviewsY = 0;
scroll(); assert.equal(calls[1].y, 0, 'clamp header offset');
assert.match(nativeSource, /ref=\{detailsScrollRef\}/);
assert.match(nativeSource, /sectionLayout\.current\.contentY = event\.nativeEvent\.layout\.y/);
assert.match(nativeSource, /sectionLayout\.current\.reviewsY = event\.nativeEvent\.layout\.y/);
console.log('PASS: actual native review-section scroll callback waits for layout, offsets header, guards stale event and runs once');

const layoutCallbacks = [];
function findLayouts(node) {
  if (ts.isJsxAttribute(node) && node.name.getText(nativeAst) === 'onLayout' && node.initializer && ts.isJsxExpression(node.initializer)) {
    const handler = node.initializer.expression?.getText(nativeAst);
    if (handler?.includes('sectionLayout.current.')) layoutCallbacks.push(handler);
  }
  ts.forEachChild(node, findLayouts);
}
findLayouts(nativeAst);
assert.equal(layoutCallbacks.length, 2);
const newLayout = {current: {eventId:'85', handled:false}};
let layoutScrollCalls = 0;
for (const handler of layoutCallbacks) {
  const makeHandler = new Function('sectionLayout','eventId','scrollToRequestedSection',`return (${handler})`);
  makeHandler(newLayout, '42', () => layoutScrollCalls++)({nativeEvent:{layout:{y:999}}});
}
assert.deepEqual(newLayout.current, {eventId:'85', handled:false});
assert.equal(layoutScrollCalls, 0, 'late layout callbacks for the old event cannot scroll the new event');
for (const handler of layoutCallbacks) {
  const makeHandler = new Function('sectionLayout','eventId','scrollToRequestedSection',`return (${handler})`);
  makeHandler(newLayout, '85', () => layoutScrollCalls++)({nativeEvent:{layout:{y:400}}});
}
assert.equal(newLayout.current.contentY, 400);
assert.equal(newLayout.current.reviewsY, 400);
assert.equal(layoutScrollCalls, 2);
assert.match(nativeSource, /<View key=\{eventId\} style=\{s.content\}/, 'new event remounts content to receive fresh layout positions');
console.log('PASS: stale native event layout callbacks cannot overwrite current event positions');
