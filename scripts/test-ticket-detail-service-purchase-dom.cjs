#!/usr/bin/env node
/**
 * Mount the complete production web/native pass screens with real TanStack Query.
 * Reuse the existing self-service harness's offline host/auth/QR adapters only;
 * tier queryFns, effects, filtering, action JSX and shared helpers stay real.
 * Synthetic records only. No network, credential issuance or payment is performed.
 */
const { test, before, beforeEach, afterEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const ROOT = path.resolve(__dirname, '..');
// Bundled React schedulers own MessageChannels; close those test-only ports after all mounted work.
const OriginalMessageChannel = global.MessageChannel;
const channels = [];
global.MessageChannel = class extends OriginalMessageChannel { constructor() { super(); channels.push(this); } };
const dependencyPaths = (process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean);
const resolveDependency = (name) => require.resolve(name, { paths: [ROOT, ...dependencyPaths] });
const harnessFile = path.join(__dirname, 'test-ticket-self-service-dom.cjs');
const harnessSource = fs.readFileSync(harnessFile, 'utf8');
const testStart = harnessSource.indexOf('(async () => {');
assert.ok(testStart > 0, 'shared fixture definitions must precede the self-service test runner');
const shared = { exports: {} };
vm.runInNewContext(harnessSource.slice(0, testStart) + '\nmodule.exports = { fixture, record };', {
  require, module: shared, __dirname, process, console,
}, { filename: harnessFile });
const { fixture, record } = shared.exports;
// The prior self-service harness returns [] for upgrade queries. That would
// conceal this regression. Run the actual production query through React Query.
delete fixture['@tanstack/react-query'];
fixture['@dvnt/app/lib/api/ticket-types'] = `import {state} from 'ticket-test-fixture';
  export const ticketTypesApi={getByEvent:async eventId=>{
    state.catalogRequests.push(eventId);
    if(state.deferCatalog) return new Promise((resolve,reject)=>state.catalogReleases.push({resolve,reject}));
    if(state.catalogError) throw new Error('Synthetic catalog unavailable');
    return state.catalog;
  }};`;

// Exercise the actual production catalog hook, including its event-scoped key.
const hooksFile = path.join(ROOT, 'packages/app/lib/hooks/use-tickets.ts');
const hooksSource = fs.readFileSync(hooksFile, 'utf8');
const hooksAst = ts.createSourceFile(hooksFile, hooksSource, ts.ScriptTarget.Latest, true);
const catalogHook = hooksAst.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'useTicketTypes');
assert.ok(catalogHook, 'real useTicketTypes hook must exist');
const hookAdapterKey = '@dvnt/app/lib/hooks/use-tickets';
const adapterAst = ts.createSourceFile('offline-hooks.ts', fixture[hookAdapterKey], ts.ScriptTarget.Latest, true);
fixture[hookAdapterKey] = adapterAst.statements.filter(node =>
  !(ts.isVariableStatement(node) && node.declarationList.declarations.some(declaration => declaration.name.getText(adapterAst) === 'useTicketTypes')),
).map(node => node.getText(adapterAst)).join('\n');
fixture[hookAdapterKey] += `
  import {useQuery} from '@tanstack/react-query';
  import {qk} from '@dvnt/app/lib/query/keys';
  import {STALE_TIMES,GC_TIMES} from '@dvnt/app/lib/perf/stale-time-config';
  import {ticketsApi} from 'ticket-test-fixture';
  ${catalogHook.getText(hooksAst)}`;
fixture['ticket-test-fixture'] += `
  ticketsApi.getTicketTypes=async eventId=>{
    state.catalogRequests.push(eventId);
    if(state.deferCatalog) return new Promise((resolve,reject)=>state.catalogReleases.push({resolve,reject}));
    if(state.catalogError) throw new Error('Synthetic catalog unavailable');
    return state.catalog;
  };`;

const source = `import React,{act} from 'react';import {createRoot} from 'react-dom/client';
  import {QueryClient,QueryClientProvider,timeoutManager} from '@tanstack/react-query';
  timeoutManager.setTimeoutProvider({setTimeout:(fn,ms)=>{const t=setTimeout(fn,ms);t.unref?.();return t;},clearTimeout,setInterval:(fn,ms)=>{const t=setInterval(fn,ms);t.unref?.();return t;},clearInterval});
  import {TicketDetailScreen} from './packages/app/features/events/ticket-detail.web';
  import NativeTicketScreen from './packages/app/features/routes/screens/(protected)/ticket/[id]';
  import {state,useFixture} from 'ticket-test-fixture';
  import {useTicketDetailUIStore} from './packages/app/lib/stores/ticket-detail-ui-store';
  export {act,state,useFixture,useTicketDetailUIStore};
  export const mount=(node,platform)=>{
    const queryClient=new QueryClient({defaultOptions:{queries:{retry:false,gcTime:Infinity}}});
    const root=createRoot(node);
    return {queryClient,render:()=>root.render(<React.StrictMode><QueryClientProvider client={queryClient}>{platform==='web'?<TicketDetailScreen/>:<NativeTicketScreen/>}</QueryClientProvider></React.StrictMode>),unmount:()=>{root.unmount();queryClient.clear();}};
  };`;
let f, dom, mounted, dir;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ticket-detail-service-'));
  await require(resolveDependency('esbuild')).build({
    stdin: { contents: source, resolveDir: ROOT, loader: 'tsx' },
    bundle: true, platform: 'node', format: 'cjs', jsx: 'automatic',
    outfile: path.join(dir, 'test.cjs'), nodePaths: dependencyPaths,
    alias: Object.fromEntries(['react', 'react-dom', 'zustand'].map(name => [name, path.dirname(resolveDependency(name + '/package.json'))])),
    define: { __DEV__: 'false' }, tsconfigRaw: { compilerOptions: { jsx: 'react-jsx' } },
    plugins: [{ name: 'offline-ticket-service-boundaries', setup(b) {
      b.onResolve({ filter: /.*/ }, a => {
        if (Object.hasOwn(fixture, a.path)) return { path: a.path, namespace: 'fixture' };
        if (a.path.startsWith('.')) {
          const resolved = path.resolve(a.resolveDir, a.path);
          const alias = '@dvnt/app/' + path.relative(path.join(ROOT, 'packages/app'), resolved).replace(/\\/g, '/');
          if (Object.hasOwn(fixture, alias)) return { path: alias, namespace: 'fixture' };
        }
        if (a.path.startsWith('@dvnt/app/')) {
          const stem = path.join(ROOT, 'packages/app', a.path.slice(10));
          for (const suffix of ['', '.ts', '.tsx']) if (fs.existsSync(stem + suffix)) return { path: stem + suffix };
        }
      });
      b.onLoad({ filter: /.*/, namespace: 'fixture' }, a => ({ contents: fixture[a.path], loader: 'tsx', resolveDir: ROOT }));
    }}],
  });
  f = require(path.join(dir, 'test.cjs'));
});
const admission = { id: 'tier-a', event_id: 71, category: 'admission', name: 'General Admission', price_cents: 2500, quantity_total: 20, quantity_sold: 0, max_per_user: 4, is_active: true, status: 'on_sale', tier_visibility: 'public' };
const coat = { ...admission, id: 'service-coat', category: 'service', name: 'Coat Check', price_cents: 1000 };
const vip = { ...admission, id: 'admission-vip', name: 'VIP Admission', price_cents: 5000 };
const flush = async (run) => f.act(async () => { await run?.(); await new Promise(resolve => setTimeout(resolve, 0)); });
const buttons = () => [...document.querySelectorAll('button')];
const upgrades = () => buttons().filter(button => /^Upgrade to /.test(button.textContent.trim()));
const serviceAction = () => buttons().find(button => button.textContent.trim().startsWith('Buy Coat Check') || button.getAttribute('aria-label') === 'Buy Coat Check');
const click = async (button) => { assert.ok(button, 'expected service purchase action'); await flush(() => button.click()); };
async function mount(platform, ticket = record(), catalog = [admission, coat], extra = {}, catalogState = {}) {
  Object.assign(f.state, { calls: [], toasts: [], navigations: [], invalidations: [], queries: [], catalogRequests: [], catalogReleases: [], deferCatalog: false, catalogError: false, catalog, ...catalogState });
  f.useTicketDetailUIStore.getState().reset();
  f.useFixture.setState({ routeId: ticket?.id ?? 'ticket-a', viewerId: 'viewer-a', ticket, group: null, routeRows: null, isLoading: false, isError: false, addons: [], storeTicket: undefined, pendingError: false, incoming: [], outgoing: [], ...extra });
  mounted = f.mount(document.getElementById('root'), platform);
  await flush(() => mounted.render());
  await flush();
}
beforeEach(async () => {
  const { Window } = await import(resolveDependency('happy-dom'));
  dom = new Window({ url: 'https://synthetic.invalid/ticket/ticket-a' });
  dom.document.body.innerHTML = '<div id="root"></div>';
  Object.assign(global, { window: dom, document: dom.document, HTMLElement: dom.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
});
afterEach(async () => { if (mounted) await flush(() => mounted.unmount()); mounted = null; await dom.happyDOM.close(); });
after(() => { fs.rmSync(dir, { recursive: true, force: true }); require(resolveDependency('esbuild')).stop(); for (const channel of channels) { channel.port1.close(); channel.port2.close(); } global.MessageChannel = OriginalMessageChannel; });

for (const platform of ['web', 'native']) {
  test(`${platform}: a comp pass never advertises Coat Check as an admission upgrade`, async () => {
    await mount(platform, record(), [admission, coat]);
    assert.ok(f.state.catalogRequests.length > 0, 'actual tier query/effect executes');
    assert.equal(upgrades().some(button => /Coat Check/.test(button.textContent)), false);
    assert.ok(serviceAction(), 'Coat Check remains available through a distinct purchase entry');
  });
}

for (const platform of ['web', 'native']) {
  const serviceHref = platform === 'web' ? '/feed/events/71?serviceTier=service-coat' : '/(protected)/events/71?serviceTier=service-coat';
  for (const kind of ['comp', 'free', 'paid']) {
    for (const status of ['active', 'scanned']) {
      test(`${platform}: ${status} ${kind} holder buys Coat Check separately without replacing the pass`, async () => {
        const sourceTier = kind === 'free' ? { ...admission, price_cents: 0 } : admission;
        const ticket = record({ status, purchase_amount_cents: kind === 'paid' ? 2500 : 0, checked_in_at: status === 'scanned' ? '2026-01-01T21:00:00Z' : null });
        const original = JSON.stringify(ticket);
        // Sold out/capped admission must not suppress an available service.
        await mount(platform, ticket, [{ ...sourceTier, quantity_sold: 20, max_per_user: 1 }, coat, vip]);
        assert.equal(upgrades().some(button => /Coat Check/.test(button.textContent)), false);
        if (status === 'active') assert.ok(upgrades().some(button => /VIP Admission/.test(button.textContent)), 'admission upgrade remains available');
        else assert.equal(upgrades().length, 0, 'scanned admission cannot be upgraded');
        assert.ok(serviceAction());
        assert.equal(f.state.calls.length, 0, 'render starts no transaction');
        await click(serviceAction());
        assert.deepEqual(f.state.navigations, [serviceHref]);
        assert.equal(f.state.calls.length, 0, 'service entry only navigates; checkout stays explicit');
        assert.equal(JSON.stringify(f.useFixture.getState().ticket), original);
        if (platform === 'native') assert.equal(document.querySelector('[data-ticket-qr]').getAttribute('data-ticket-qr'), ticket.qr_token);
        else assert.ok([...document.querySelectorAll('img')].some(image => image.getAttribute('src')?.endsWith(ticket.qr_token)), 'original QR remains intact');
      });
    }
  }

  for (const [reason, patch] of [
    ['sold out', { quantity_sold: 20 }],
    ['inactive', { is_active: false }],
    ['future sale', { sale_start: '2099-01-01T00:00:00Z' }],
    ['hidden', { tier_visibility: 'hidden' }],
    ['locked', { tier_visibility: 'locked' }],
    ['different event', { event_id: 72 }],
    ['product, not service', { category: 'product' }],
  ]) {
    test(`${platform}: ${reason} Coat Check is not advertised as a purchasable service or upgrade`, async () => {
      await mount(platform, record(), [admission, { ...coat, ...patch }]);
      assert.equal(serviceAction(), undefined);
      assert.equal(upgrades().some(button => /Coat Check/.test(button.textContent)), false);
      assert.equal(f.state.calls.length, 0);
    });
  }

  for (const [reason, ticketPatch, extra] of [
    ['refunded', { status: 'refunded' }, {}],
    ['void', { status: 'void' }, {}],
    ['transfer pending', { status: 'transfer_pending' }, {}],
    ['another account', { user_id: 'other-owner' }, {}],
    ['anonymous viewer', {}, { viewerId: 'anon' }],
  ]) {
    test(`${platform}: ${reason} pass grants no service or upgrade shortcut`, async () => {
      await mount(platform, record(ticketPatch), [admission, coat, vip], extra);
      assert.equal(serviceAction(), undefined);
      assert.equal(upgrades().length, 0);
      assert.equal(f.state.calls.length, 0);
    });
  }

  test(`${platform}: own service cap, not comp admission cap, controls the named shortcut`, async () => {
    const held = record({ id: 'held-service', ticket_type_id: coat.id, category: 'service' });
    await mount(platform, record(), [admission, { ...coat, max_per_user: 1 }], { group: [record(), held] });
    assert.equal(serviceAction(), undefined, 'exhausted own service allowance is not advertised');
    await flush(() => f.useFixture.setState({ group: [record(), { ...held, user_id: 'other-owner' }] }));
    assert.ok(serviceAction(), 'another account cached service cannot exhaust current holder allowance');
    await click(serviceAction());
    assert.deepEqual(f.state.navigations, [serviceHref]);
  });

  test(`${platform}: missing or non-admission upgrade source never turns a service into admission`, async () => {
    await mount(platform, record({ ticket_type_id: 'source-service', category: 'admission' }), [coat, vip]);
    assert.equal(upgrades().length, 0, 'missing authoritative source refuses an upgrade');
    assert.ok(serviceAction(), 'separate service purchase remains allowed for the valid holder');
  });

  test(`${platform}: catalog failure leaves pass intact and never invents an upgrade/service offer`, async () => {
    await mount(platform, record(), [], {}, { catalogError: true });
    assert.equal(upgrades().length, 0);
    assert.equal(serviceAction(), undefined);
    assert.equal(f.useFixture.getState().ticket.qr_token, 'issued-qr-a');
    assert.equal(f.state.calls.length, 0);
  });

  test(`${platform}: account change during catalog fetch cannot expose the old holder shortcut`, async () => {
    await mount(platform, record(), [], {}, { deferCatalog: true });
    assert.equal(serviceAction(), undefined);
    await flush(() => f.useFixture.setState({ viewerId: 'other-viewer' }));
    await flush(() => { for (const pending of f.state.catalogReleases) pending.resolve([admission, coat, vip]); });
    await flush();
    assert.equal(serviceAction(), undefined);
    assert.equal(upgrades().length, 0);
    assert.deepEqual(f.state.navigations, []);
    assert.equal(f.state.calls.length, 0);
  });
}
