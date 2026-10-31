// Repeat-purchase regressions mount the actual production event screen and checkout sheet.
// Synthetic fixtures only: no network, payment processor, database, or real ticket issuance.
// No network, checkout requests, holds, orders, or browser credentials are used.
// Dependencies: typescript, react, react-dom, zustand, happy-dom (normal dev deps or NODE_PATH).
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { Window } = require('happy-dom');
const ROOT = path.resolve(__dirname, '..');
const detailFile = path.join(ROOT, 'packages/app/features/events/event-detail.web.tsx');
const source = fs.readFileSync(detailFile, 'utf8');
const noop = () => {};
const Empty = () => null;
const store = (state) => Object.assign((select = (value) => value) => select(state), { getState: () => state });
const paid = { id: '22222222-2222-4222-8222-222222222222', name: 'Paid fixture tier', event_id: 42, price_cents: 2500, quantity_total: 20, quantity_sold: 0, category: 'admission', max_per_user: 4, is_active: true, status: 'on_sale' };
const free = { ...paid, id: '11111111-1111-4111-8111-111111111111', name: 'Free fixture tier', price_cents: 0 };
const service = { ...paid, id: '33333333-3333-4333-8333-333333333333', category: 'service', name: 'Coat Check', price_cents: 1000, max_per_user: 10 };
const existingTicket = { id: '44444444-4444-4444-8444-444444444444', event_id: 42, ticket_type_id: paid.id, user_id: 'member-auth', status: 'active', category: 'admission', qr_token: 'synthetic-original-credential' };
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
const attendeePrivacy = load(path.join(ROOT, 'packages/app/lib/events/event-attendee-visibility.ts'));
const mocks = {};
// Render unrelated page furniture as empty components, then explicitly supply
// every hook/data dependency touched by the purchase and missing-event paths.
const ast = ts.createSourceFile(detailFile, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
for (const statement of ast.statements) {
  if (!ts.isImportDeclaration(statement)) continue;
  const name = statement.moduleSpecifier.text;
  const entry = mocks[name] ??= { __esModule: true };
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
  useQueryClient: () => ({ invalidateQueries: (input) => scenario.invalidations.push(input) }),
};
app('lib/hooks/use-events', {
  eventKeys: { all: ['events'] },
  useEvents: () => scenario.eventsQuery,
  useEvent: (id) => { scenario.resolvedIds.push(id); return id ? scenario.eventQuery : query(undefined, { isPending: true }); },
  useDeleteEvent: () => ({ isPending: false }),
  useToggleEventLike: () => ({ mutate: noop }),
  useRsvpEvent: () => ({ isPending: false, mutate: (value) => scenario.memberRsvps.push(value) }),
});
app('lib/hooks/use-event-attendee-privacy', { useEventAttendeePrivacy: (_id, event) => attendeePrivacy.canShowEventAttendees(event) });
app('components/event/WhoAllOverThere.web', { WhoAllOverThere: ({ canUpload }) => React.createElement('div', { 'data-testid': 'moments-upload-access', 'data-can-upload': String(canUpload) }) });
app('components/event/GoingAccordion.web', { GoingAccordion: ({ attendees }) => React.createElement('div', null, attendees.map(a => a.username).join(', ')) });
app('lib/hooks/use-event-title-route', { useEventTitleRoute: () => ({ ...scenario.indexQuery, routingIndex: !scenario.indexQuery.isError && !scenario.indexQuery.isFetching ? scenario.indexQuery.data : undefined }) });
app('lib/hooks/use-tickets', {
  useTicketTypes: () => scenario.tiersQuery,
  useMyTicketStatusForEvent: () => ({ primary: scenario.tickets[0] ?? null, tickets: scenario.tickets, data: scenario.tickets, isPending: scenario.ticketsPending, isError: false }),
  useTicketViewerId: () => scenario.auth.isAuthenticated ? scenario.auth.user.id : 'anon',
  useTicketViewerAuthId: () => scenario.auth.isAuthenticated ? scenario.auth.user.authId : null,
  useTicketViewerIdentityPending: () => false,
});
app('lib/tickets/ticket-access', load(path.join(ROOT, 'packages/app/lib/tickets/ticket-access.ts')));
app('lib/hooks/use-ticket-checkout', { useTicketCheckout: () => ({ checkout: async (input) => { scenario.memberCheckouts.push(input); return scenario.checkoutResult ?? { success: true, free: true, tickets: [] }; }, isLoading: scenario.isCheckingOut }) });
app('lib/hooks/use-ticket-upgrade', { useTicketUpgradeOptions: () => [], useInitiateUpgrade: () => ({ mutate: noop, isPending: false }) });
app('lib/hooks/use-event-waitlist', { useEventWaitlistStatus: () => query(null), useJoinWaitlist: () => ({ isPending: false }), useLeaveWaitlist: () => ({ isPending: false }) });
app('lib/hooks/use-event-reviews', { useCreateEventReview: () => ({ isPending: false }) });
app('lib/hooks/use-age-verification', { useAgeVerificationStatus: () => query(null), needsAgeVerification: () => false });
app('components/event/TicketsOpeningSoonCard.web', { TicketsOpeningSoonCard: () => React.createElement('div', { 'data-testid': 'tickets-opening-soon' }, 'Tickets coming soon') });
app('lib/hooks/use-event-role', { useEventRole: () => ({ role: null }) });
app('lib/hooks/use-event-lynk-host', { useEventLynkHost: () => scenario.lynkHost || ({}) });
app('lib/hooks/use-event-lynk-entry', { useEventLynkEntry: () => scenario.lynkEntry || ({open: noop, isOpening:false}) });
app('lib/color/useEventDominantColor', { useEventDominantColor: () => ({ color: '#000' }) });
app('lib/stores/auth-store', { useAuthStore: (select) => select(scenario.auth) });
app('lib/stores/event-detail-ui-store', { useEventDetailUiStore: ui });
app('lib/stores/guest-checkout-store', { useGuestCheckoutStore: store({ openSheet: (value) => scenario.guestCheckouts.push(value) }) });
app('lib/stores/guest-rsvp-store', { useGuestRsvpStore: store({ openSheet: (...value) => scenario.guestRsvps.push(value) }) });
app('lib/stores/ui-store', { useUIStore: store({ showToast: (...args) => scenario.toasts.push(args) }) });
app('lib/stores/lightbox-store', { useLightboxStore: store({ openAt: noop }) });
app('lib/stores/ticket-store', { useTicketStore: store({ setTicket: (...args) => scenario.ticketWrites.push(args) }) });
app('lib/stores/promotion-store', { usePromotionStore: store({ openSheet: noop }) });
app('lib/stores/sale-notify-store', { useSaleNotifyStore: store({ subscribedEventIds: [], toggle: noop }) });
app('lib/stores/promoter-ref-store', { usePromoterRefStore: store({ refs: {}, setRef: noop, getRef: () => null }) });
app('lib/stores/addon-upsell-store', { useAddonUpsellStore: store({ eventId: '42', selectionList: () => [], reset: noop }) });
app('lib/stores/cart', { useCartStore: store({ get cart() { return scenario.pendingCart; }, startCart: (eventId) => { scenario.carts.push({ eventId, lines: [] }); }, addLineItem: (eventId, item) => { scenario.carts.at(-1).lines.push(item); } }) });
app('components/bottom-sheet.web', { BottomSheet: ({ open, onClose, children, title }) => open ? React.createElement('div', { role: 'dialog', 'aria-label': title }, React.createElement('button', { onClick: onClose }, 'Close checkout'), children) : null });
Object.assign(mocks['./addon-upsell.web'], { addonSelectionsTotalCents: () => 0 });
app('lib/stores/translation-store', { useContentTranslation: () => ({ displayText: '', isTranslated: false }) });
app('lib/payments/checkout-sheet-totals', load(path.join(ROOT, 'packages/app/lib/payments/checkout-sheet-totals.ts')));
app('lib/payments/checkout-code', load(path.join(ROOT, 'packages/app/lib/payments/checkout-code.ts')));
app('lib/api/promoters', { promotersApi: { getClaim: async () => null } });
Object.assign(mocks['./use-checkout-code.web'], { useCheckoutCode: () => noop });
Object.assign(mocks['@dvnt/ui'], { Dialog: Object.assign(Empty, { Root: Empty, Content: Empty, Header: Empty, Title: Empty, Description: Empty, Footer: Empty, Close: Empty }) });
for (const relative of ['lib/query/keys', 'lib/tickets/pricing', 'lib/tickets/purchase-quantity', 'lib/tickets/guest-purchase-state', 'lib/events/event-detail-state', 'lib/events/event-detail-route', 'lib/events/event-discovery', 'lib/events/event-time', 'lib/events/event-zone', 'lib/auth/return-to']) {
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
  dom = new Window({ url: 'https://fixture.invalid/public/events/42' });
  dom.document.body.innerHTML = '<div id="root"></div>';
  global.window = dom; global.document = dom.document; global.IS_REACT_ACT_ENVIRONMENT = true;
  root = createRoot(document.getElementById('root'));
  scenario = {
    params: { id: '42' }, resolvedIds: [], auth: { isAuthenticated: false, user: null }, tickets: [], ticketsPending: false, isCheckingOut: false, pendingCart: null, checkoutResult: null, invalidations: [], ticketWrites: [], toasts: [], carts: [], memberCheckouts: [], navigation: [], guestCheckouts: [], guestRsvps: [], memberRsvps: [], retries: [],
    eventsQuery: query([]), indexQuery: query([]), tokenQuery: query(undefined, { isPending: true }),
    eventQuery: query(fixtureEvent, { refetch: () => scenario.retries.push('event') }),
    tiersQuery: query([free, paid], { refetch: () => scenario.retries.push('tiers') }),
  };
  ui.getState().reset();
});
afterEach(async () => { await React.act(async () => root.unmount()); await dom.happyDOM.close(); });


function member(tickets = [existingTicket]) {
  scenario.auth = { isAuthenticated: true, user: { id: 'member', authId: 'member-auth', username: 'fixture-member' } };
  scenario.tickets = tickets.map((ticket) => ({ ...ticket }));
}
const tierButton = (id) => document.querySelector(`[data-testid="ticket-tier-${id}"]`);
const purchaseButton = () => document.querySelector('[data-testid="event-purchase-action"]');
const viewButton = () => [...document.querySelectorAll('button')].find((node) => /^View tickets?$/i.test(node.textContent.trim()));
const labelButton = (label) => [...document.querySelectorAll('button')].find((node) => node.getAttribute('aria-label') === label);
const submitButton = () => [...document.querySelectorAll('[role="dialog"] button')].find((node) => /^(Pay |Review order|Confirm RSVP|Confirm service|Confirm order|Confirm item)/.test(node.textContent.trim()));

// Existing holders may choose a different quantity/tier without losing the
// credential route or altering the ticket that was previously purchased.
test('existing member can select and buy additional tickets independently of View ticket', async () => {
  member();
  const before = JSON.stringify(scenario.tickets);
  await render();
  assert.ok(viewButton());
  assert.equal(tierButton(paid.id).disabled, false);
  assert.match(purchaseButton()?.textContent ?? '', /buy (additional|more)/i);
  await click(viewButton());
  assert.deepEqual(scenario.navigation, [`/feed/ticket/${existingTicket.id}`]);
  scenario.navigation = [];
  await click(tierButton(paid.id));
  await click(purchaseButton());
  assert.equal(ui.getState().checkoutOpen, true);
  assert.equal(ui.getState().selectedTierId, paid.id);
  assert.ok(document.querySelector('[role="dialog"]'));
  await click(submitButton());
  assert.equal(scenario.carts.length, 1);
  assert.equal(scenario.carts[0].lines.length, 1);
  assert.equal(scenario.carts[0].lines[0].tierId, paid.id);
  assert.equal(scenario.carts[0].lines[0].quantity, 1);
  assert.equal(scenario.carts[0].lines[0].category, 'admission');
  assert.deepEqual(scenario.navigation, ['/feed/checkout/review']);
  assert.equal(JSON.stringify(scenario.tickets), before);
});

test('existing holder checks out Coat Check alone as service, never additional admission', async () => {
  member();
  scenario.tiersQuery = query([paid, service]);
  scenario.eventQuery = query({ ...fixtureEvent, ticketTiers: [paid, service] });
  const before = JSON.stringify(scenario.tickets);
  await render();
  assert.equal(tierButton(service.id).disabled, false);
  await click(tierButton(service.id));
  assert.equal(ui.getState().checkoutOpen, false);
  await click(purchaseButton());
  assert.match(document.querySelector('[role="dialog"]').textContent, /Coat Check/);
  await click(submitButton());
  assert.equal(scenario.carts.length, 1);
  assert.equal(scenario.carts[0].lines.length, 1);
  assert.equal(scenario.carts[0].lines[0].tierId, service.id);
  assert.equal(scenario.carts[0].lines[0].category, 'service');
  assert.equal(scenario.carts[0].lines[0].quantity, 1);
  assert.equal(scenario.memberCheckouts.length, 0);
  assert.equal(JSON.stringify(scenario.tickets), before);
});

test('service-only selection is reachable for signed-out buyers without adding GA or forcing login', async () => {
  scenario.tiersQuery = query([paid, service]);
  scenario.eventQuery = query({ ...fixtureEvent, ticketTiers: [paid, service] });
  await render();
  await click(tierButton(service.id));
  await click(purchaseButton());
  assert.equal(scenario.guestCheckouts.length, 1);
  assert.equal(scenario.guestCheckouts[0].tierId, service.id);
  assert.equal(scenario.guestCheckouts[0].priceCents, 1000);
  assert.equal(scenario.carts.length, 0);
  assert.deepEqual(scenario.navigation, []);
});

test('holder can close and reopen checkout, choose a new tier, and repeated open taps make no orders', async () => {
  member();
  await render();
  await React.act(async () => { purchaseButton().click(); purchaseButton().click(); });
  assert.equal(document.querySelectorAll('[role="dialog"]').length, 1);
  assert.equal(scenario.carts.length, 0);
  assert.equal(scenario.memberCheckouts.length, 0);
  await click(button('Close checkout'));
  assert.equal(document.querySelector('[role="dialog"]'), null);
  assert.ok(viewButton());
  await click(tierButton(free.id));
  assert.equal(ui.getState().ticketQty, 1);
  await click(purchaseButton());
  assert.equal(ui.getState().selectedTierId, free.id);
  await click(button('Close checkout'));
  assert.equal(scenario.carts.length, 0);
  assert.equal(scenario.memberCheckouts.length, 0);
});

test('holder can purchase another free tier through ticket checkout rather than an event RSVP', async () => {
  member();
  await render();
  await click(tierButton(free.id));
  await click(purchaseButton());
  await click(submitButton());
  assert.equal(scenario.memberCheckouts.length, 1);
  assert.equal(scenario.memberCheckouts[0].ticketTypeId, free.id);
  assert.equal(scenario.memberCheckouts[0].quantity, 1);
  assert.equal(scenario.memberRsvps.length, 0);
  assert.equal(scenario.carts.length, 0);
});

test('sold-out, future-sale and paused tiers stay unbuyable to an existing holder', async () => {
  member();
  for (const patch of [{ quantity_sold: 20 }, { sale_start: '2099-01-01T00:00:00Z' }, { is_active: false }]) {
    scenario.tiersQuery = query([{ ...paid, ...patch }]);
    scenario.eventQuery = query({ ...fixtureEvent, ticketTiers: [paid] });
    await render();
    assert.ok(viewButton());
    const row = tierButton(paid.id);
    assert.equal(row?.disabled ?? true, true);
    if (purchaseButton()) assert.equal(purchaseButton().disabled, true);
    if (row) await click(row);
    assert.equal(ui.getState().checkoutOpen, false);
    assert.equal(scenario.carts.length, 0);
  }
});

test('ended and cancelled events keep existing credentials but never reopen purchase', async () => {
  member();
  for (const eventPatch of [{ fullDate: '2000-01-01T00:00:00Z', endDate: '2000-01-01T01:00:00Z' }, { status: 'cancelled' }]) {
    scenario.eventQuery = query({ ...fixtureEvent, ...eventPatch });
    await render();
    assert.equal(purchaseButton()?.disabled ?? true, true);
    assert.equal(tierButton(paid.id)?.disabled ?? true, true);
    assert.equal(ui.getState().checkoutOpen, false);
  }
});

test('another account or signed-out viewer cannot use a cached original holder credential', async () => {
  member();
  await render();
  assert.ok(viewButton());
  scenario.auth = { isAuthenticated: true, user: { id: 'other-member', authId: 'other-auth', username: 'fixture-other' } };
  await render();
  assert.equal(viewButton(), undefined);
  assert.equal(purchaseButton().disabled, false);
  scenario.auth = { isAuthenticated: false, user: null };
  await render();
  assert.equal(viewButton(), undefined);
  await click(purchaseButton());
  assert.equal(scenario.guestCheckouts.length, 1);
  assert.deepEqual(scenario.navigation, []);
});

test('first-time member service-only checkout also keeps its server-defined category', async () => {
  member([]);
  scenario.tiersQuery = query([service]);
  scenario.eventQuery = query({ ...fixtureEvent, ticketTiers: [service] });
  await render();
  await click(tierButton(service.id));
  await click(purchaseButton());
  await click(submitButton());
  assert.equal(scenario.carts.length, 1);
  assert.equal(scenario.carts[0].lines.length, 1);
  assert.equal(scenario.carts[0].lines[0].category, 'service');
  assert.equal(scenario.carts[0].lines[0].tierId, service.id);
});

test('additional quantity is bounded by remaining per-person allowance and current inventory', async () => {
  member([existingTicket, { ...existingTicket, id: 'synthetic-second' }, { ...existingTicket, id: 'synthetic-third' }]);
  await render();
  await click(tierButton(paid.id));
  await click(purchaseButton());
  assert.equal(ui.getState().ticketQty, 1);
  assert.equal(labelButton('Increase quantity').disabled, true);
  await click(labelButton('Increase quantity'));
  assert.equal(ui.getState().ticketQty, 1);
  await click(button('Close checkout'));
  // Unrelated admissions do not consume the service's own allowance.
  scenario.tiersQuery = query([paid, { ...service, quantity_total: 1, quantity_sold: 0 }]);
  scenario.eventQuery = query({ ...fixtureEvent, ticketTiers: [paid, service] });
  await render();
  await click(tierButton(service.id));
  await click(purchaseButton());
  assert.equal(labelButton('Increase quantity').disabled, true);
  assert.equal(ui.getState().ticketQty, 1);
});

test('reaching one tier limit does not prevent buying a separate service', async () => {
  member(Array.from({ length: 4 }, (_, i) => ({ ...existingTicket, id: `synthetic-admission-${i}` })));
  scenario.tiersQuery = query([paid, service]);
  scenario.eventQuery = query({ ...fixtureEvent, ticketTiers: [paid, service] });
  await render();
  assert.equal(tierButton(paid.id).disabled, true);
  assert.equal(tierButton(service.id).disabled, false);
  await click(tierButton(service.id));
  await click(purchaseButton());
  await click(submitButton());
  assert.equal(scenario.carts[0].lines[0].category, 'service');
  assert.equal(scenario.carts[0].lines[0].tierId, service.id);
});


test('same-frame repeated paid submit creates one cart and one review navigation', async () => {
  member();
  await render();
  await click(purchaseButton());
  const submit = submitButton();
  await React.act(async () => { submit.click(); submit.click(); });
  assert.equal(scenario.carts.length, 1);
  assert.deepEqual(scenario.navigation, ['/feed/checkout/review']);
});

test('payment-bound cart is recovered after Back navigation rather than replaced by a second purchase', async () => {
  member();
  scenario.pendingCart = { cartId: 'synthetic-original-cart', eventId: '42', status: 'paying', paymentIntentId: 'pi_synthetic_existing', idempotencyKey: 'synthetic-original-key', lineItems: [{ category: 'admission', tierId: paid.id, quantity: 1 }] };
  const original = JSON.stringify(scenario.pendingCart);
  scenario.tiersQuery = query([paid, service]);
  scenario.eventQuery = query({ ...fixtureEvent, ticketTiers: [paid, service] });
  await render();
  await click(tierButton(service.id));
  await click(purchaseButton());
  await click(submitButton());
  assert.equal(scenario.carts.length, 0);
  assert.equal(JSON.stringify(scenario.pendingCart), original);
  assert.deepEqual(scenario.navigation, ['/feed/checkout/review']);
});

test('inventory exhausted while sheet is open blocks submitting its stale quantity', async () => {
  member();
  await render();
  await click(purchaseButton());
  scenario.tiersQuery = query([free, { ...paid, quantity_sold: 20 }]);
  await render();
  const submit = submitButton();
  if (submit) await click(submit);
  assert.equal(scenario.carts.length, 0);
  assert.equal(scenario.memberCheckouts.length, 0);
  assert.deepEqual(scenario.navigation, []);
});


test('free service confirmation refreshes library without overwriting admission or claiming event entry', async () => {
  for (const held of [[], [existingTicket]]) {
    member(held);
    scenario.checkoutResult = { success: true, free: true, tickets: [{ id: 'synthetic-new-service', qr_token: 'synthetic-service-only' }] };
    const freeService = { ...service, price_cents: 0 };
    scenario.tiersQuery = query([freeService]);
    scenario.eventQuery = query({ ...fixtureEvent, ticketTiers: [freeService] });
    scenario.ticketWrites = []; scenario.memberCheckouts = []; scenario.invalidations = []; scenario.toasts = [];
    await React.act(async () => ui.getState().reset());
    await render();
    await click(tierButton(service.id));
    await click(purchaseButton());
    assert.doesNotMatch(document.querySelector('[role="dialog"]').textContent, /Confirm RSVP/);
    await click(submitButton());
    assert.equal(scenario.memberCheckouts.length, 1);
    assert.equal(scenario.memberCheckouts[0].ticketTypeId, service.id);
    assert.equal(scenario.ticketWrites.length, 0);
    assert.ok(scenario.invalidations.length >= 2);
    const message = scenario.toasts.flat().join(' ');
    assert.match(message, /Coat Check.*confirmed/i);
    assert.match(message, /admission.*separately/i);
    assert.doesNotMatch(message, /You're going/i);
    assert.deepEqual(scenario.tickets, held);
  }
});

test('additional free admission leaves the previously held legacy ticket intact', async () => {
  member();
  scenario.checkoutResult = { success: true, free: true, tickets: [{ id: 'synthetic-new-free-admission', qr_token: 'synthetic-new-credential' }] };
  const before = JSON.stringify(scenario.tickets);
  await render();
  await click(tierButton(free.id));
  await click(purchaseButton());
  await click(submitButton());
  assert.equal(scenario.ticketWrites.length, 0);
  assert.equal(JSON.stringify(scenario.tickets), before);
  assert.ok(scenario.invalidations.length >= 2);
});

test('a previous account maxed-out cache cannot consume the current buyer allowance', async () => {
  member(Array.from({ length: 4 }, (_, i) => ({ ...existingTicket, id: `synthetic-old-account-${i}` })));
  scenario.auth = { isAuthenticated: true, user: { id: 'new-member', authId: 'new-auth', username: 'fixture-new' } };
  await render();
  assert.equal(viewButton(), undefined);
  assert.equal(tierButton(paid.id).disabled, false);
  assert.equal(purchaseButton().disabled, false);
  await click(purchaseButton());
  assert.equal(labelButton('Increase quantity').disabled, false);
});

test('a completed prior cart permits a distinct additional purchase without modifying the prior cart', async () => {
  member();
  scenario.pendingCart = { cartId: 'synthetic-completed-cart', eventId: '42', status: 'completed', paymentIntentId: 'pi_synthetic_complete', idempotencyKey: 'synthetic-complete-key', lineItems: [{ category: 'admission', tierId: paid.id, quantity: 1 }] };
  const original = JSON.stringify(scenario.pendingCart);
  await render();
  await click(purchaseButton());
  await click(submitButton());
  assert.equal(scenario.carts.length, 1);
  assert.equal(scenario.carts[0].lines[0].tierId, paid.id);
  assert.equal(JSON.stringify(scenario.pendingCart), original);
  assert.deepEqual(scenario.navigation, ['/feed/checkout/review']);
});


test('service-only holder can view and buy services without receiving attendee upload access', async () => {
  const heldService = { ...existingTicket, id: 'synthetic-held-service', ticket_type_id: service.id, category: 'service' };
  member([heldService]);
  scenario.tiersQuery = query([paid, service]);
  scenario.eventQuery = query({ ...fixtureEvent, ticketTiers: [paid, service] });
  await render();
  assert.ok(viewButton());
  assert.equal(purchaseButton().disabled, false);
  assert.equal(document.querySelector('[data-testid="moments-upload-access"]').getAttribute('data-can-upload'), 'false');
  scenario.tickets = [existingTicket, heldService];
  await render();
  assert.equal(document.querySelector('[data-testid="moments-upload-access"]').getAttribute('data-can-upload'), 'true');
});
