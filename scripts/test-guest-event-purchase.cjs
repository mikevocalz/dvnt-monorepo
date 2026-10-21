// Synthetic ReactDOM regressions against the actual EventDetailScreen module.
// No network, checkout requests, holds, orders, or browser credentials are used.
// Dependencies: typescript, react, react-dom, zustand, jsdom (normal dev deps or NODE_PATH).
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { JSDOM } = require('jsdom');
const ROOT = path.resolve(__dirname, '..');
const detailFile = path.join(ROOT, 'packages/app/features/events/event-detail.web.tsx');
const source = fs.readFileSync(detailFile, 'utf8');
const noop = () => {};
const Empty = () => null;
const store = (state) => Object.assign((select = (value) => value) => select(state), { getState: () => state });
const paid = { id: '22222222-2222-4222-8222-222222222222', name: 'Paid fixture tier', event_id: 42, price_cents: 2500, quantity_total: 20, quantity_sold: 0, is_active: true, status: 'on_sale' };
const free = { ...paid, id: '11111111-1111-4111-8111-111111111111', name: 'Free fixture tier', price_cents: 0 };
const fixtureEvent = { id: 42, title: 'Synthetic public event', description: '', price: 25, ticketingEnabled: true, ticketTiers: [free, paid], visibility: 'public', status: 'active', host: { username: 'fixture-host' }, fullDate: '2099-01-01T20:00:00Z' };
const query = (data, patch = {}) => ({ data, isPending: false, isFetching: false, isError: false, refetch: noop, ...patch });
let scenario, dom, root;
const cache = new Map();
function load(file) {
  if (!path.extname(file)) file += '.ts';
  if (cache.has(file)) return cache.get(file);
  const exports = {};
  cache.set(file, exports);
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'react', target: ts.ScriptTarget.ES2022 } });
  assert.equal((compiled.diagnostics || []).length, 0);
  vm.runInNewContext(compiled.outputText, { exports, require: (name) => name.startsWith('.') ? load(path.resolve(path.dirname(file), name)) : require(name), console, Date, Set }, { filename: file });
  return exports;
}
const ui = load(path.join(ROOT, 'packages/app/lib/stores/event-detail-ui-store.ts')).useEventDetailUiStore;
const mocks = {};
// Render unrelated page furniture as empty components, then explicitly supply
// every hook/data dependency touched by the purchase and missing-event paths.
const ast = ts.createSourceFile(detailFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
for (const statement of ast.statements) {
  if (!ts.isImportDeclaration(statement)) continue;
  const name = statement.moduleSpecifier.text;
  const entry = mocks[name] = { __esModule: true };
  const bindings = statement.importClause?.namedBindings;
  if (bindings && ts.isNamedImports(bindings)) for (const binding of bindings.elements) entry[(binding.propertyName || binding.name).text] = /^[A-Z]/.test(binding.name.text) ? Empty : noop;
  if (statement.importClause?.name) entry.default = Empty;
}
const app = (suffix, values) => Object.assign(mocks['@dvnt/app/' + suffix], values);
mocks.react = React;
mocks['react/jsx-runtime'] = require('react/jsx-runtime');
mocks['solito/navigation'] = { useParams: () => scenario.params, usePathname: () => '/public/events/42', useRouter: () => ({ push: (url) => scenario.navigation.push(url), back: noop }) };
mocks['@tanstack/react-query'] = {
  useQuery: ({ queryKey, enabled }) => {
    if (queryKey[1] === 'share-token') return scenario.tokenQuery;
    if (queryKey[1] === 'slug-index') return scenario.indexQuery;
    return query(queryKey[0] === 'event-addons' ? [] : null, { isPending: enabled === false });
  },
  useQueryClient: () => ({ invalidateQueries: noop }),
};
app('lib/hooks/use-events', {
  useEvents: () => scenario.eventsQuery,
  useEvent: (id) => { scenario.resolvedIds.push(id); return id ? scenario.eventQuery : query(undefined, { isPending: true }); },
  useDeleteEvent: () => ({ isPending: false }),
  useToggleEventLike: () => ({ mutate: noop }),
  useRsvpEvent: () => ({ isPending: false, mutate: (value) => scenario.memberRsvps.push(value) }),
});
app('lib/hooks/use-event-title-route', { useEventTitleRoute: () => ({ ...scenario.indexQuery, routingIndex: !scenario.indexQuery.isError && !scenario.indexQuery.isFetching ? scenario.indexQuery.data : undefined }) });
app('lib/hooks/use-tickets', {
  useTicketTypes: () => scenario.tiersQuery,
  useMyTicketStatusForEvent: () => ({ primary: null, isPending: false, isError: false }),
  useTicketViewerId: () => scenario.auth.isAuthenticated ? 'member' : 'anon',
  useTicketViewerAuthId: () => scenario.auth.isAuthenticated ? 'member-auth' : null,
  useTicketViewerIdentityPending: () => false,
});
app('lib/tickets/ticket-access', { resolveTicketAccess: () => ({ canShowCredential: false }) });
app('lib/hooks/use-ticket-checkout', { useTicketCheckout: () => ({ checkout: noop, isLoading: false }) });
app('lib/hooks/use-ticket-upgrade', { useTicketUpgradeOptions: () => [], useInitiateUpgrade: () => ({ mutate: noop, isPending: false }) });
app('lib/hooks/use-event-waitlist', { useEventWaitlistStatus: () => query(null), useJoinWaitlist: () => ({ isPending: false }), useLeaveWaitlist: () => ({ isPending: false }) });
app('lib/hooks/use-event-reviews', { useCreateEventReview: () => ({ isPending: false }) });
app('lib/hooks/use-age-verification', { useAgeVerificationStatus: () => query(null), needsAgeVerification: () => false });
app('components/event/TicketsOpeningSoonCard.web', { TicketsOpeningSoonCard: () => React.createElement('div', { 'data-testid': 'tickets-opening-soon' }, 'Tickets coming soon') });
app('lib/hooks/use-event-role', { useEventRole: () => ({ role: null }) });
app('lib/hooks/use-event-lynk-host', { useEventLynkHost: () => ({}) });
app('lib/color/useEventDominantColor', { useEventDominantColor: () => ({ color: '#000' }) });
app('lib/stores/auth-store', { useAuthStore: (select) => select(scenario.auth) });
app('lib/stores/event-detail-ui-store', { useEventDetailUiStore: ui });
app('lib/stores/guest-checkout-store', { useGuestCheckoutStore: store({ openSheet: (value) => scenario.guestCheckouts.push(value) }) });
app('lib/stores/guest-rsvp-store', { useGuestRsvpStore: store({ openSheet: (...value) => scenario.guestRsvps.push(value) }) });
app('lib/stores/ui-store', { useUIStore: store({ showToast: noop }) });
app('lib/stores/lightbox-store', { useLightboxStore: store({ openAt: noop }) });
app('lib/stores/ticket-store', { useTicketStore: store({ setTicket: noop }) });
app('lib/stores/promotion-store', { usePromotionStore: store({ openSheet: noop }) });
app('lib/stores/sale-notify-store', { useSaleNotifyStore: store({ subscribedEventIds: [], toggle: noop }) });
app('lib/stores/promoter-ref-store', { usePromoterRefStore: store({ refs: {}, setRef: noop, getRef: () => null }) });
app('lib/stores/addon-upsell-store', { useAddonUpsellStore: store({ reset: noop }) });
app('lib/stores/translation-store', { useContentTranslation: () => ({ displayText: '', isTranslated: false }) });
app('lib/payments/checkout-sheet-totals', { computeCheckoutSheetTotals: () => ({ promoDiscountCents: 0, promoterDiscountCents: 0, feeCents: 0, totalCents: 0 }) });
app('lib/api/promoters', { promotersApi: { getClaim: async () => null } });
Object.assign(mocks['./use-checkout-code.web'], { useCheckoutCode: () => ({}) });
Object.assign(mocks['@dvnt/ui'], { Dialog: Object.assign(Empty, { Root: Empty, Content: Empty, Header: Empty, Title: Empty, Description: Empty, Footer: Empty, Close: Empty }) });
for (const relative of ['lib/tickets/pricing', 'lib/tickets/guest-purchase-state', 'lib/events/event-detail-state', 'lib/events/event-detail-route', 'lib/events/event-discovery', 'lib/events/event-time', 'lib/events/event-zone', 'lib/auth/return-to']) {
  mocks['@dvnt/app/' + relative] = load(path.join(ROOT, 'packages/app', relative + '.ts'));
}
mocks['./ticket-upgrade-benefits'] = load(path.join(ROOT, 'packages/app/features/events/ticket-upgrade-benefits.ts'));
const exportsObject = {};
const compiled = ts.transpileModule(source, { fileName: detailFile, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, jsxImportSource: 'react', target: ts.ScriptTarget.ES2022 } });
vm.runInNewContext(compiled.outputText, {
  exports: exportsObject,
  require: (name) => { assert.ok(mocks[name], 'unmocked import ' + name); return mocks[name]; },
  console, Date, Set, URLSearchParams,
  get window() { return global.window; },
}, { filename: detailFile });
const Screen = exportsObject.EventDetailScreen;
async function render() { await React.act(async () => root.render(React.createElement(Screen))); }
function button(text) { return [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === text); }
async function click(node) { assert.ok(node, 'expected button'); await React.act(async () => node.click()); }
function assertNoPurchase() { assert.equal(scenario.guestCheckouts.length, 0); assert.equal(scenario.guestRsvps.length, 0); assert.deepEqual(scenario.navigation, []); }
beforeEach(() => {
  dom = new JSDOM('<!doctype html><div id="root"></div>', { url: 'https://fixture.invalid/public/events/42' });
  global.window = dom.window; global.document = dom.window.document; global.IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.getElementById('root'));
  scenario = {
    params: { id: '42' }, resolvedIds: [], auth: { isAuthenticated: false, user: null }, navigation: [], guestCheckouts: [], guestRsvps: [], memberRsvps: [], retries: [],
    eventsQuery: query([]), indexQuery: query([]), tokenQuery: query(undefined, { isPending: true }),
    eventQuery: query(fixtureEvent, { refetch: () => scenario.retries.push('event') }),
    tiersQuery: query([free, paid], { refetch: () => scenario.retries.push('tiers') }),
  };
  ui.getState().reset();
});
afterEach(async () => { await React.act(async () => root.unmount()); dom.window.close(); });

test('actual screen waits for slow tiers and disables display-only ticket buttons', async () => {
  scenario.tiersQuery = query(undefined, { isPending: true, isFetching: true });
  await render();
  assert.match(document.body.textContent, /Loading tickets/);
  assert.equal(button('Get tickets'), undefined);
  for (const node of [...document.querySelectorAll('button')].filter((node) => node.textContent.includes('fixture tier'))) { assert.equal(node.disabled, true); await click(node); }
  assertNoPurchase();
});

test('actual error screen retries both reads and then opens the paid guest tier', async () => {
  scenario.tiersQuery = query(undefined, { isError: true, refetch: () => scenario.retries.push('tiers') });
  await render();
  assert.match(document.body.textContent, /Tickets couldn't be loaded/);
  await click(button('Try again'));
  assert.deepEqual(scenario.retries, ['event', 'tiers']);
  assertNoPurchase();
  scenario.tiersQuery = query([free, paid]);
  await render();
  await click(button('Get tickets'));
  assert.equal(scenario.guestCheckouts[0].tierId, paid.id);
  assert.equal(scenario.guestCheckouts[0].priceCents, 2500);
  assert.deepEqual(scenario.navigation, []);
});

test('empty paid tiers remain unavailable instead of opening login', async () => {
  scenario.tiersQuery = query([]);
  await render();
  assert.match(document.body.textContent, /Tickets are currently unavailable/);
  assert.equal(button('Get tickets'), undefined);
  assertNoPurchase();
});

test('a missing display-tier row is disabled while an adjacent action buys the selected free row', async () => {
  scenario.tiersQuery = query([free]);
  await render();
  const buttons = [...document.querySelectorAll('button')];
  const missing = buttons.find((node) => node.textContent.includes(paid.name));
  assert.equal(missing.disabled, true);
  await click(missing);
  assertNoPurchase();
  await click(buttons.find((node) => node.textContent.includes(free.name)));
  assertNoPurchase();
  await click(button('Get free ticket'));
  assert.equal(scenario.guestCheckouts[0].tierId, free.id);
  assert.equal(scenario.guestCheckouts[0].priceCents, 0);
  assert.equal(scenario.guestRsvps.length, 0);
  assert.deepEqual(scenario.navigation, []);
});

test('only confirmed tier-less free events open guest RSVP', async () => {
  scenario.eventQuery = query({ ...fixtureEvent, price: 0, ticketingEnabled: false, ticketTiers: [] });
  scenario.tiersQuery = query([]);
  await render();
  await click(button('RSVP'));
  assert.deepEqual(scenario.guestRsvps, [['42', fixtureEvent.title]]);
  assert.equal(scenario.guestCheckouts.length, 0);
  assert.deepEqual(scenario.navigation, []);
});

test('direct-ID missing/private/failed detail renders a generic retry without sign-in', async () => {
  for (const patch of [{}, { isError: true }]) {
    scenario.eventQuery = query(null, { ...patch, refetch: () => scenario.retries.push('event') });
    scenario.indexQuery = query(undefined, { isPending: true });
    await render();
    assert.match(document.body.textContent, /This event is unavailable/);
    assert.doesNotMatch(document.body.textContent, /Synthetic public event|Loading…|Sign in/);
    await click(button('Try again'));
    assertNoPurchase();
  }
  assert.deepEqual(scenario.retries, ['event', 'event']);
});

test('direct-ID detail loading resolves without waiting for unrelated slug-index data', async () => {
  scenario.eventQuery = query(undefined, { isPending: true, isFetching: true });
  scenario.indexQuery = query(undefined, { isPending: true });
  await render();
  assert.match(document.body.textContent, /Loading…/);
  scenario.eventQuery = query(fixtureEvent);
  await render();
  await click(button('Get tickets'));
  assert.equal(scenario.guestCheckouts[0].tierId, paid.id);
  assert.deepEqual(scenario.navigation, []);
});

test('member checkout and tier-less RSVP still use their existing member actions', async () => {
  scenario.auth = { isAuthenticated: true, user: { id: 'member', username: 'fixture-member' } };
  await render();
  await click(button('Get tickets'));
  assert.equal(ui.getState().checkoutOpen, true);
  assert.equal(ui.getState().selectedTierId, paid.id);
  assertNoPurchase();
  scenario.eventQuery = query({ ...fixtureEvent, price: 0, ticketingEnabled: false, ticketTiers: [] });
  scenario.tiersQuery = query([]);
  await render();
  await click(button('RSVP'));
  assert.equal(scenario.memberRsvps.length, 1);
  assert.equal(scenario.memberRsvps[0].eventId, '42');
  assertNoPurchase();
});

test('unlimited inventory is buyable and scheduled tiers remain unavailable', async () => {
  scenario.tiersQuery = query([{ ...paid, quantity_total: null }]);
  await render();
  await click(button('Get tickets'));
  assert.equal(scenario.guestCheckouts[0].tierId, paid.id);
  assert.equal(button('Join waitlist · Sold out'), undefined);
  scenario.guestCheckouts = [];
  scenario.tiersQuery = query([{ ...paid, sale_start: '2099-01-01T00:00:00Z' }]);
  await render();
  assert.equal(button('Get tickets'), undefined);
  assert.match(document.body.textContent, /Tickets are currently unavailable/);
  assertNoPurchase();
});

test('a confirmed sold-out event keeps its explicitly labeled waitlist action', async () => {
  scenario.tiersQuery = query([{ ...paid, quantity_sold: 20 }]);
  await render();
  assert.ok(button('Join waitlist · Sold out'));
  assert.equal(button('Get tickets'), undefined);
  assertNoPurchase();
});

test('zero and malformed numeric-route IDs do not wait on disabled queries', async () => {
  for (const id of ['0', 'not-a-number']) {
    scenario.params = { id };
    scenario.eventQuery = query(undefined, { isPending: true });
    scenario.indexQuery = query(undefined, { isPending: true });
    await render();
    assert.match(document.body.textContent, /This event is unavailable/);
    assert.doesNotMatch(document.body.textContent, /Loading…/);
    assertNoPurchase();
  }
});

test('stale cached ticket rows after a failed refresh cannot bypass retry state', async () => {
  scenario.tiersQuery = query([paid], { isError: true });
  await render();
  assert.match(document.body.textContent, /Tickets couldn't be loaded/);
  const row = [...document.querySelectorAll('button')].find((node) => node.textContent.includes(paid.name));
  assert.equal(row.disabled, true);
  await click(row);
  assertNoPurchase();
});


test('selection and purchase share one top-of-page area before event details', async () => {
  scenario.eventQuery = query({ ...fixtureEvent, description: 'Fixture event details' });
  await render();
  const group = document.querySelector('[data-testid="event-purchase"]');
  assert.ok(group);
  assert.equal(document.querySelectorAll('[data-testid="event-purchase"]').length, 1);
  assert.equal([...document.querySelectorAll('h2')].filter((n) => n.textContent === 'Tickets').length, 1);
  const rows = group.querySelectorAll('[data-testid^="ticket-tier-"]');
  assert.equal(rows.length, 2);
  assert.equal(group.querySelector('[data-testid="event-purchase-action"]').textContent, 'Get tickets');
  assert.equal(rows[0].getAttribute('aria-pressed'), 'false');
  assert.equal(rows[1].getAttribute('aria-pressed'), 'true');
  const about = [...document.querySelectorAll('h2')].find((n) => n.textContent === 'About');
  assert.ok(group.compareDocumentPosition(about) & window.Node.DOCUMENT_POSITION_FOLLOWING);
});

test('guest paid/free choices only select until the adjacent purchase action is pressed', async () => {
  await render();
  const row = (id) => document.querySelector(`[data-testid="ticket-tier-${id}"]`);
  await click(row(free.id));
  assert.equal(ui.getState().selectedTierId, free.id);
  assert.equal(row(free.id).getAttribute('aria-pressed'), 'true');
  assert.equal(row(paid.id).getAttribute('aria-pressed'), 'false');
  assert.equal(ui.getState().checkoutOpen, false);
  assertNoPurchase();
  await click(button('Get free ticket'));
  assert.equal(scenario.guestCheckouts[0].tierId, free.id);
  assert.equal(scenario.guestCheckouts[0].priceCents, 0);
  scenario.guestCheckouts = [];
  await click(row(paid.id));
  assertNoPurchase();
  await click(button('Get tickets'));
  assert.equal(scenario.guestCheckouts[0].tierId, paid.id);
  assert.equal(scenario.guestCheckouts[0].priceCents, 2500);
  assert.deepEqual(scenario.navigation, []);
});

test('member selection stays inline, resets stale quantity and opens that exact tier', async () => {
  scenario.auth = { isAuthenticated: true, user: { id: 'member', username: 'fixture-member' } };
  await render();
  await React.act(async () => ui.getState().setTicketQty(6));
  await click(document.querySelector(`[data-testid="ticket-tier-${free.id}"]`));
  assert.equal(ui.getState().ticketQty, 1);
  assert.equal(ui.getState().checkoutOpen, false);
  assertNoPurchase();
  await click(button('Get free ticket'));
  assert.equal(ui.getState().checkoutOpen, true);
  assert.equal(ui.getState().selectedTierId, free.id);
  assertNoPurchase();
});

test('a selected tier becoming unavailable never silently buys another tier', async () => {
  await render();
  await click(document.querySelector(`[data-testid="ticket-tier-${paid.id}"]`));
  scenario.tiersQuery = query([free, { ...paid, quantity_sold: 20 }]);
  await render();
  const action = button('Select an available ticket');
  assert.ok(action);
  assert.equal(action.disabled, true);
  await click(action);
  assertNoPurchase();
  await click(document.querySelector(`[data-testid="ticket-tier-${free.id}"]`));
  await click(button('Get free ticket'));
  assert.equal(scenario.guestCheckouts[0].tierId, free.id);
});

test('live tiers missing from an older display aggregate are visible and selectable', async () => {
  scenario.eventQuery = query({ ...fixtureEvent, ticketTiers: [] });
  await render();
  assert.equal(document.querySelector('[data-testid="tickets-opening-soon"]'), null);
  const paidRow = document.querySelector(`[data-testid="ticket-tier-${paid.id}"]`);
  assert.ok(paidRow);
  assert.equal(paidRow.disabled, false);
  assert.equal(paidRow.getAttribute('aria-pressed'), 'true');
  await click(button('Get tickets'));
  assert.equal(scenario.guestCheckouts[0].tierId, paid.id);
});

test('hidden/locked tiers are not selectable and members do not RSVP into missing inventory', async () => {
  scenario.auth = { isAuthenticated: true, user: { id: 'member', username: 'fixture-member' } };
  scenario.eventQuery = query({ ...fixtureEvent, price: 0 });
  scenario.tiersQuery = query([{ ...free, tier_visibility: 'hidden' }, { ...paid, tier_visibility: 'locked' }]);
  await render();
  assert.equal(document.querySelectorAll('[data-testid^="ticket-tier-"]').length, 0);
  assert.equal(button('RSVP'), undefined);
  assert.equal(button('Get tickets'), undefined);
  assert.match(document.body.textContent, /Have a code/);
  assertNoPurchase();
});


test('live-only legacy benefit objects render safely as explicit organizer text', async () => {
  scenario.eventQuery = query({ ...fixtureEvent, ticketTiers: [free] });
  scenario.tiersQuery = query([free, { ...paid, perks: [{ label: 'Coat check' }, { text: 'Dungeon access' }, null, { invalid: true }] }]);
  await render();
  const paidRow = document.querySelector(`[data-testid="ticket-tier-${paid.id}"]`);
  assert.ok(paidRow);
  assert.match(paidRow.textContent, /Coat check/);
  assert.match(paidRow.textContent, /Dungeon access/);
  assert.doesNotMatch(paidRow.textContent, /object Object|welcome drink|VIP lounge/);
  await click(button('Get tickets'));
  assert.equal(scenario.guestCheckouts[0].tierId, paid.id);
});

test('member stale selection remains blocked until an explicit replacement', async () => {
  scenario.auth = { isAuthenticated: true, user: { id: 'member', username: 'fixture-member' } };
  await render();
  await click(document.querySelector(`[data-testid="ticket-tier-${paid.id}"]`));
  scenario.tiersQuery = query([free, { ...paid, tier_visibility: 'locked' }]);
  await render();
  assert.equal(button('Select an available ticket').disabled, true);
  assert.equal(ui.getState().checkoutOpen, false);
  await click(document.querySelector(`[data-testid="ticket-tier-${free.id}"]`));
  await click(button('Get free ticket'));
  assert.equal(ui.getState().selectedTierId, free.id);
  assert.equal(ui.getState().checkoutOpen, true);
});

test('server-unlocked tier becomes selectable inline', async () => {
  scenario.eventQuery = query({ ...fixtureEvent, ticketTiers: [] });
  scenario.tiersQuery = query([{ ...paid, tier_visibility: 'locked' }]);
  await render();
  assert.equal(document.querySelector(`[data-testid="ticket-tier-${paid.id}"]`), null);
  await React.act(async () => ui.getState().addUnlockedTierIds([paid.id]));
  const row = document.querySelector(`[data-testid="ticket-tier-${paid.id}"]`);
  assert.ok(row);
  assert.equal(row.disabled, false);
  await click(row);
  assertNoPurchase();
  await click(button('Get tickets'));
  assert.equal(scenario.guestCheckouts[0].tierId, paid.id);
});


test('title route never renders or fetches a different cached event while its index is pending or failed', async () => {
  scenario.params = { slug: 'synthetic-public-event' };
  scenario.eventsQuery = query([{ ...fixtureEvent, id: 99 }]);
  scenario.indexQuery = query([{ ...fixtureEvent, id: 99 }], { isFetching: true });
  await render();
  assert.equal(scenario.resolvedIds.at(-1), '');
  assert.match(document.body.textContent, /Loading…/);
  assert.doesNotMatch(document.body.textContent, /Synthetic public event/);
  scenario.indexQuery = query([{ ...fixtureEvent, id: 99 }], { isError: true });
  await render();
  assert.equal(scenario.resolvedIds.at(-1), '');
  assert.doesNotMatch(document.body.textContent, /Synthetic public event/);
  scenario.indexQuery = query([fixtureEvent]);
  await render();
  assert.equal(scenario.resolvedIds.at(-1), '42');
  assert.match(document.body.textContent, /Synthetic public event/);
});

test('share-token route keeps its token identity even when the public index is unavailable', async () => {
  scenario.params = { slug: 'a'.repeat(32) };
  scenario.tokenQuery = query({ id: 42 });
  scenario.indexQuery = query(undefined, { isPending: true });
  await render();
  assert.equal(scenario.resolvedIds.at(-1), '42');
  assert.match(document.body.textContent, /Synthetic public event/);
});
