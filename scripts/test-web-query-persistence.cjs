// Real provider and TanStack persistence, with only browser storage simulated.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { renderToString } = require('react-dom/server');
const { JSDOM } = require('jsdom');
const { useQuery, useIsRestoring, useQueryClient } = require('@tanstack/react-query');
const ROOT = path.resolve(__dirname, '..');
const KEY = 'fixture-query-cache';
function load(relative, cache = new Map()) {
  if (cache.has(relative)) return cache.get(relative);
  const exports = {};
  cache.set(relative, exports);
  const filename = path.join(ROOT, 'packages/api/src', relative);
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    fileName: filename, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  });
  assert.deepEqual(compiled.diagnostics, [], filename + " must parse cleanly");
  const code = compiled.outputText;
  const localRequire = name => {
    if (name === '@dvnt/core') return { DVNT_QUERY_CACHE_KEY: KEY };
    if (name === './persistence') return load('persistence.web.ts', cache);
    if (name === './queryClient') return load('queryClient.ts', cache);
    return require(name);
  };
  const context = { exports, require: localRequire, process, console, setTimeout, clearTimeout };
  Object.defineProperty(context, 'window', { get: () => global.window });
  vm.runInNewContext(code, context, { filename });
  return exports;
}
const { createPlatformPersister, shouldDehydrateQuery } = load('persistence.web.ts');
const { ApiProvider } = load('ApiProvider.tsx');
const denied = () => { throw new DOMException('Storage disabled', 'SecurityError'); };
let client;
function Child() {
  client = useQueryClient();
  const restoring = useIsRestoring();
  const query = useQuery({ queryKey: ['events', 'fixture'], queryFn: async () => 'network-ready' });
  return React.createElement('div', { 'data-testid': 'child' }, restoring ? 'restoring' : query.data || 'loading');
}
async function mount(storageDescriptor) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'https://fixture.invalid' });
  global.window = dom.window;
  global.document = dom.window.document;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, 'localStorage', { configurable: true, ...storageDescriptor });
  const root = createRoot(document.getElementById('root'));
  await React.act(async () => { root.render(React.createElement(ApiProvider, null, React.createElement(Child))); });
  await React.act(async () => { await new Promise(r => setTimeout(r, 30)); });
  assert.equal(document.querySelector('[data-testid="child"]').textContent, 'network-ready');
  await React.act(async () => root.unmount());
  client.clear();
  dom.window.close();
}
(async () => {
  delete global.window;
  assert.equal(createPlatformPersister(), undefined);
  assert.match(renderToString(React.createElement(ApiProvider, null, React.createElement('div', null, 'server-ready'))), /server-ready/);
  global.window = {};
  assert.equal(createPlatformPersister(), undefined);
  Object.defineProperty(window, 'localStorage', { get: denied });
  assert.equal(createPlatformPersister(), undefined);
  await mount({ get: denied });
  await mount({ value: { getItem: denied, setItem: denied, removeItem: denied } });
  // Methods may start throwing later; read/remove must still be harmless.
  global.window = { localStorage: { getItem: denied, setItem: denied, removeItem: denied } };
  const blocked = createPlatformPersister();
  assert.equal(blocked.restoreClient(), undefined);
  assert.doesNotThrow(() => blocked.removeClient());
  blocked.persistClient({ timestamp: Date.now(), buster: '', clientState: { queries: [], mutations: [] } });
  const data = new Map();
  let writes = 0;
  global.window = { localStorage: { getItem: k => data.get(k) ?? null, setItem: (k,v) => { writes++; data.set(k,v); }, removeItem: k => data.delete(k) } };
  const good = createPlatformPersister();
  const snapshot = { timestamp: Date.now(), buster: 'fixture', clientState: { queries: [], mutations: [] } };
  good.persistClient(snapshot);
  await new Promise(r => setTimeout(r, 1100));
  assert.equal(writes, 1);
  assert.deepEqual(good.restoreClient(), snapshot);
  good.removeClient();
  assert.equal(data.has(KEY), false);
  assert.equal(shouldDehydrateQuery({ queryKey: ['events'] }), true);
  assert.equal(shouldDehydrateQuery({ queryKey: ['likeState'] }), false);
  const populated = { timestamp: Date.now(), buster: 'fixture', clientState: { mutations: [], queries: [
    { queryKey: ['events', 'old'], queryHash: 'old', state: { data: 'old', dataUpdatedAt: 1 } },
    { queryKey: ['events', 'new'], queryHash: 'new', state: { data: 'new', dataUpdatedAt: 2 } },
  ] } };
  let quotaWrites = 0;
  let saved;
  global.window = { localStorage: { getItem: () => saved ?? null, removeItem() {}, setItem(k, v) {
    quotaWrites++;
    if (quotaWrites === 1) throw new DOMException('Full', 'QuotaExceededError');
    saved = v;
  } } };
  const quota = createPlatformPersister();
  quota.persistClient(populated);
  let deniedWrites = 0;
  global.window = { localStorage: { getItem: () => null, removeItem() {}, setItem() { deniedWrites++; denied(); } } };
  createPlatformPersister().persistClient(populated);
  await new Promise(r => setTimeout(r, 1100));
  assert.equal(deniedWrites, 1, 'security denial must not retry or prune queries');
  assert.equal(quotaWrites, 2, 'quota failure retries with oldest query removed');
  assert.deepEqual(quota.restoreClient().clientState.queries.map(q => q.queryHash), ['new']);
  assert.equal(populated.clientState.queries.length, 2, 'live snapshot remains unchanged');
  await mount({ value: { getItem: () => null, setItem() {}, removeItem() {} } });
  console.log('PASS: SSR, absent/denied getter, denied read/write/remove, successful persistence, actual provider/network rendering');
})().catch(error => { console.error(error); process.exitCode = 1; });
