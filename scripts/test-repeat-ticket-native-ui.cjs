// Mount production native StickyCTA with only native host primitives replaced.
// No network or credential/payment side effects; every fixture is synthetic.
const { test, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const React = require('react');
const { createRoot } = require('react-dom/client');
const { Window } = require('happy-dom');
const Empty = () => null;
const View = ({ children }) => React.createElement('div', null, children);
const Text = ({ children }) => React.createElement('span', null, children);
const Pressable = ({ children, onPress, disabled, accessibilityLabel, accessibilityHint }) => React.createElement('button', { onClick: onPress, disabled, 'aria-label': accessibilityLabel, title: accessibilityHint }, children);
const filename = path.resolve(__dirname, '../packages/app/features/events/ui/StickyCTA.tsx');
const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { fileName: filename, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText;
const mocks = {
  react: React,
  'react/jsx-runtime': require('react/jsx-runtime'),
  'react-native': { View, Text, Pressable, ActivityIndicator: () => React.createElement('span', { role: 'progressbar' }), StyleSheet: { create: (v) => v } },
  'react-native-safe-area-context': { useSafeAreaInsets: () => ({ bottom: 0 }) },
  'lucide-react-native': { Ticket: Empty, Check: Empty, Clock: Empty, BellRing: Empty, BellOff: Empty },
  'react-native-reanimated': { __esModule: true, default: { View }, useSharedValue: (value) => React.useRef({ value }).current, useAnimatedStyle: (run) => run(), withRepeat: () => 0, withTiming: (v) => v, withSequence: () => 0, interpolate: () => 0 },
};
const exportsObject = {};
vm.runInNewContext(output, { exports: exportsObject, require: (name) => { assert.ok(mocks[name], `unmocked ${name}`); return mocks[name]; }, Date, console, setInterval, clearInterval });
const CTA = exportsObject.StickyCTA;
const paidTier = { id: 'synthetic-admission', name: 'General Admission', price: 25, category: 'admission', isSoldOut: false, glowColor: '#379ED8' };
const serviceTier = { ...paidTier, id: 'synthetic-service', name: 'Coat Check', category: 'service', price: 10 };
let window, root, state, props;
const button = (text) => [...document.querySelectorAll('button')].find((node) => node.textContent.trim() === text);
const additional = () => [...document.querySelectorAll('button')].find((node) => /^Buy (additional|more)/i.test(node.textContent.trim()));
const render = async (patch = {}) => { props = { ...props, ...patch }; await React.act(async () => root.render(React.createElement(CTA, props))); };
const click = async (node) => { assert.ok(node, 'button exists'); await React.act(async () => node.click()); };
beforeEach(() => {
  window = new Window({ url: 'https://fixture.invalid' });
  window.document.body.innerHTML = '<div id="root"></div>';
  Object.assign(global, { window, document: window.document, IS_REACT_ACT_ENVIRONMENT: true });
  root = createRoot(document.getElementById('root'));
  state = { purchases: 0, credentials: 0, recoveries: 0, waitlists: 0 };
  props = { selectedTier: paidTier, hasTicket: true, onGetTickets: () => state.recoveries++, onViewTicket: () => state.credentials++, onBuyMore: () => state.purchases++, onJoinWaitlist: () => state.waitlists++ };
});
afterEach(async () => { await React.act(async () => root.unmount()); await window.happyDOM.close(); });

test('native holder keeps separate View Ticket and Buy additional for paid, service and free tiers', async () => {
  for (const selectedTier of [paidTier, serviceTier, { ...paidTier, id: 'synthetic-free', price: 0 }]) {
    await render({ selectedTier });
    assert.equal(button('View Ticket').disabled, false);
    assert.equal(additional().disabled, false);
    await click(button('View Ticket'));
    await click(additional());
  }
  assert.deepEqual(state, { purchases: 3, credentials: 3, recoveries: 0, waitlists: 0 });
});

test('native exhausted allowance, sold out and unavailable tiers never suppress viewing a held pass', async () => {
  for (const patch of [{ purchaseDisabledReason: 'Maximum per person reached' }, { selectedTier: { ...paidTier, isSoldOut: true } }, { tiersUnavailable: true }]) {
    await render({ selectedTier: paidTier, purchaseDisabledReason: undefined, tiersUnavailable: false, ...patch });
    assert.equal(additional().disabled, true);
    await click(additional());
    await click(button('View Ticket'));
  }
  assert.equal(state.purchases, 0);
  assert.equal(state.credentials, 3);
});

test('native ended/cancelled events expose no additional purchase', async () => {
  await render({ isPast: true });
  assert.equal(additional(), undefined);
  await click(button('View Ticket'));
  await render({ isPast: false, isCancelled: true });
  assert.equal(additional(), undefined);
  await click(button('View Ticket · Refunded'));
  assert.equal(state.purchases, 0);
  assert.equal(state.credentials, 2);
});

test('native pending checkout takes priority over holder buy-more and only recovers original payment', async () => {
  await render({ checkoutState: 'checking' });
  assert.equal(additional(), undefined);
  assert.equal(button('Confirming tickets...').disabled, true);
  await click(button('Confirming tickets...'));
  assert.equal(state.recoveries, 0);
  await render({ checkoutState: 'pending' });
  assert.equal(additional(), undefined);
  await click(button('Check ticket status'));
  assert.equal(state.recoveries, 1);
  assert.equal(state.purchases, 0);
});

test('native first-time service buyer sees service action, not admission or RSVP copy', async () => {
  await render({ hasTicket: false, selectedTier: serviceTier, onBuyMore: undefined });
  assert.ok(button('Get service'));
  assert.doesNotMatch(document.body.textContent, /General Admission|RSVP|View Ticket/);
  await click(button('Get service'));
  assert.equal(state.recoveries, 1);
});

// Also mount the actual screen's StickyCTA JSX wiring: a component-only test
// with an invented onBuyMore prop would miss the original price > 0 gate.
const screenFilename = path.resolve(__dirname, '../packages/app/features/routes/screens/(protected)/events/[id]/index.tsx');
const screenSource = fs.readFileSync(screenFilename, 'utf8');
const screenAst = ts.createSourceFile(screenFilename, screenSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let screenCtaSource;
function findScreenCta(node) {
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(screenAst) === 'StickyCTA') screenCtaSource = node.getText(screenAst);
  ts.forEachChild(node, findScreenCta);
}
findScreenCta(screenAst);
assert.ok(screenCtaSource, 'production screen StickyCTA wiring exists');
const screenExports = {};
const screenContext = { exports: screenExports, require, StickyCTA: CTA };
vm.runInNewContext(ts.transpileModule(`exports.WiredCTA = () => (${screenCtaSource});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, screenContext);

test('production native screen wiring offers additional free and service tiers instead of only positive-price admission', async () => {
  for (const selectedTier of [paidTier, serviceTier, { ...paidTier, id: 'synthetic-free', price: 0 }]) {
    Object.assign(screenContext, {
      isCheckingOut: false, isNativeCheckoutLoading: false, pendingNativeCheckout: null,
      selectedTier, selectedDbTier: { id: selectedTier.id }, hasTicket: true, isPast: false,
      ticketQty: 1, handleGetTickets: () => state.purchases++, handleViewTicket: () => state.credentials++,
      purchaseDisabledReason: undefined, waitlistJoined: false, handleJoinWaitlist: () => {}, handleLeaveWaitlist: () => {},
      isWaitlistBusy: false, ticketTiers: [selectedTier], eventData: { price: 25 }, notifyOnSaleOpen: false,
      handleToggleSaleNotify: () => {}, isCancelled: false,
    });
    await React.act(async () => root.render(React.createElement(screenExports.WiredCTA)));
    assert.equal(additional()?.disabled, false);
    await click(additional());
    await click(button('View Ticket'));
  }
  assert.equal(state.purchases, 3);
  assert.equal(state.credentials, 3);
});

// Mount the native destination's actual tier derivation, URL effects, selection
// callback, TierCard list and StickyCTA. This covers wiring (not just invented
// props): a wallet link must select its service without auto-starting checkout.
// The payment handler is the explicit offline boundary in this destination test;
// native-checkout-screen.test.ts separately executes that production handler.
const appRoot = path.resolve(__dirname, '../packages/app');
const modules = new Map();
function loadNative(file) {
  if (!path.extname(file)) file += '.ts';
  if (modules.has(file)) return modules.get(file);
  const exports = {};
  modules.set(file, exports);
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, require: name => {
    if (mocks[name]) return mocks[name];
    if (name.startsWith('@dvnt/app/')) return loadNative(path.join(appRoot, name.slice(10)));
    if (name.startsWith('.')) return loadNative(path.resolve(path.dirname(file), name));
    return require(name);
  }, console, Date, Set });
  return exports;
}
mocks['react-native-reanimated'].default.createAnimatedComponent = value => value;
mocks['react-native-reanimated'].Easing = { out: value => value, in: value => value, cubic: value => value };
mocks['expo-haptics'] = { impactAsync: () => {}, ImpactFeedbackStyle: { Medium: 'medium' } };
const NativeTierCard = loadNative(path.join(appRoot, 'features/events/ui/TicketTierCard.tsx')).TicketTierCard;
const nativeStore = loadNative(path.join(appRoot, 'lib/stores/event-detail-screen-store.ts')).useEventDetailScreenStore;
const nativeDeclarations = new Map();
const selectionEffects = [];
let tierListSource;
function findNativePurchaseNodes(node) {
  if (ts.isVariableDeclaration(node)) nativeDeclarations.set(node.name.getText(screenAst), node.getText(screenAst));
  if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression) && node.expression.expression.getText(screenAst) === 'useEffect' && node.getText(screenAst).includes('requestedServiceTierId')) selectionEffects.push(node.getText(screenAst));
  if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(screenAst) === 'LegendList' && node.getText(screenAst).includes('TicketTierCard')) tierListSource = node.getText(screenAst);
  ts.forEachChild(node, findNativePurchaseNodes);
}
findNativePurchaseNodes(screenAst);
assert.equal(selectionEffects.length, 2, 'URL-reset and actual auto-selection effects both remain mounted');
assert.ok(tierListSource, 'actual native tier list wiring exists');
const names = ['selectedTier', 'setSelectedTier', 'ticketQty', 'setTicketQty', 'ticketTiers', 'selectedDbTier', 'selectedAllowance', 'purchaseDisabledReason', 'handleSelectTier'];
const destinationContext = {
  exports: {}, require, ...React, StickyCTA: CTA, TicketTierCard: NativeTierCard,
  LegendList: ({ data, renderItem }) => React.createElement('div', null, data.map(item => React.createElement(React.Fragment, { key: item.id }, renderItem({ item })))),
  useEventDetailScreenStore: nativeStore, s: {},
  ...loadNative(path.join(appRoot, 'lib/tickets/pricing.ts')),
  ...loadNative(path.join(appRoot, 'lib/tickets/purchase-quantity.ts')),
  ...loadNative(path.join(appRoot, 'lib/events/event-time.ts')),
};
vm.runInNewContext(ts.transpileModule(`exports.Destination = () => {
  ${names.map(name => { assert.ok(nativeDeclarations.has(name), name); return 'const ' + nativeDeclarations.get(name) + ';'; }).join('\n')}
  ${selectionEffects.join('\n')}
  const handleGetTickets = entryHandler ?? (() => checkoutAttempts.push({ ticketTypeId: selectedTier?.id, quantity: ticketQty }));
  return <><div>${tierListSource}</div>${screenCtaSource}</>;
};`, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText, destinationContext);
const dbAdmission = { id: paidTier.id, event_id: 42, name: paidTier.name, category: 'admission', price_cents: 2500, quantity_total: 20, quantity_sold: 20, max_per_user: 1, is_active: true, status: 'on_sale' };
const dbService = { ...dbAdmission, id: serviceTier.id, name: 'Coat Check', category: 'service', price_cents: 1000, quantity_sold: 0, max_per_user: 3 };
async function destination({ requested = dbService.id, service = dbService, event = {}, owned = [] } = {}) {
  nativeStore.getState().resetEventDetailScreen();
  const eventData = { id: 42, ticketingEnabled: true, price: 25, fullDate: '2099-01-01T20:00:00Z', ticketTiers: [dbAdmission, service], ...event };
  Object.assign(destinationContext, {
    eventData, safeEvent: eventData, eventId: '42', requestedServiceTierId: requested,
    liveTicketTypes: eventData.ticketTiers, ownedTickets: owned, hasTicket: true,
    isCheckingOut: false, isNativeCheckoutLoading: false, pendingNativeCheckout: null,
    isPast: false, isCancelled: false, handleViewTicket: () => state.credentials++,
    checkoutAttempts: [], entryHandler: undefined, waitlistJoined: false, handleJoinWaitlist: () => {}, handleLeaveWaitlist: () => {},
    isWaitlistBusy: false, notifyOnSaleOpen: false, handleToggleSaleNotify: () => {},
  });
  await renderDestination();
}
async function renderDestination() { await React.act(async () => root.render(React.createElement(destinationContext.exports.Destination))); }
const nativeTierButton = name => [...document.querySelectorAll('button')].find(button => button.textContent.includes(name) && !/^Buy/.test(button.textContent.trim()));

test('native wallet service link selects Coat Check despite capped/sold-out comp admission; only explicit Buy starts checkout', async () => {
  await destination({ owned: [{ ticket_type_id: dbAdmission.id, status: 'active', purchase_amount_cents: 0 }] });
  assert.equal(nativeStore.getState().selectedTier.id, dbService.id);
  assert.equal(nativeStore.getState().ticketQty, 1);
  assert.deepEqual(destinationContext.checkoutAttempts, []);
  assert.equal(additional()?.disabled, false);
  await click(additional());
  assert.equal(destinationContext.checkoutAttempts.length, 1);
  assert.equal(destinationContext.checkoutAttempts[0].ticketTypeId, dbService.id);
  assert.equal(destinationContext.checkoutAttempts[0].quantity, 1);
  await click(button('View Ticket'));
  assert.equal(state.credentials, 1);
});

for (const [reason, options] of [
  ['missing target', { requested: 'missing-service' }],
  ['admission target', { requested: dbAdmission.id }],
  ['hidden service', { service: { ...dbService, tier_visibility: 'hidden' } }],
  ['locked service', { service: { ...dbService, tier_visibility: 'locked' } }],
  ['foreign-event service', { service: { ...dbService, event_id: 43 } }],
  ['sold-out service', { service: { ...dbService, quantity_sold: 20 } }],
  ['service cap exhausted', { owned: Array.from({ length: 3 }, () => ({ ticket_type_id: dbService.id, status: 'active' })) }],
  ['closed event sales', { event: { fullDate: '2000-01-01T00:00:00Z', endDate: '2000-01-01T03:00:00Z' } }],
]) {
  test(`native ${reason} wallet link never silently offers admission checkout`, async () => {
    await destination(options);
    assert.notEqual(nativeStore.getState().selectedTier?.id, dbAdmission.id);
    assert.equal(additional()?.disabled ?? true, true);
    if (additional()) await click(additional());
    assert.deepEqual(destinationContext.checkoutAttempts, []);
    await click(button('View Ticket'));
    assert.equal(state.credentials, 1);
  });
}

test('native mounted Back/Forward service link changes clear older selection and quantity, with manual choices still usable', async () => {
  await destination({ requested: null });
  // Select through the actual native card and actual handleSelectTier.
  await click(nativeTierButton('Coat Check'));
  assert.equal(nativeStore.getState().selectedTier.id, dbService.id);
  await React.act(async () => nativeStore.getState().setTicketQty(3));
  destinationContext.requestedServiceTierId = 'missing-service';
  await renderDestination();
  assert.equal(nativeStore.getState().selectedTier, null);
  assert.equal(nativeStore.getState().ticketQty, 1);
  destinationContext.requestedServiceTierId = dbService.id;
  await renderDestination();
  assert.equal(nativeStore.getState().selectedTier.id, dbService.id);
  destinationContext.requestedServiceTierId = undefined;
  await renderDestination();
  assert.equal(nativeStore.getState().selectedTier.id, dbAdmission.id, 'removing the explicit request restores normal initial selection');
  await click(nativeTierButton('Coat Check'));
  assert.equal(nativeStore.getState().selectedTier.id, dbService.id);
  assert.deepEqual(destinationContext.checkoutAttempts, []);
});

test('native service link fails closed on authoritative category drift, then allows an explicit different service', async () => {
  await destination();
  const differentService = { ...dbService, id: 'synthetic-other-service', name: 'Synthetic Drink Service' };
  destinationContext.liveTicketTypes = [dbAdmission, { ...dbService, category: 'admission' }, differentService];
  destinationContext.eventData = { ...destinationContext.eventData, ticketTiers: [dbAdmission, dbService, differentService] };
  destinationContext.safeEvent = destinationContext.eventData;
  await renderDestination();
  assert.equal(nativeStore.getState().selectedTier.id, dbService.id);
  assert.equal(additional().disabled, true, 'authoritative admission cannot be bought from a service link');
  await click(additional());
  assert.deepEqual(destinationContext.checkoutAttempts, []);
  await click(nativeTierButton(differentService.name));
  assert.equal(nativeStore.getState().selectedTier.id, differentService.id);
  assert.equal(additional().disabled, false);
  await click(additional());
  assert.equal(destinationContext.checkoutAttempts.length, 1);
  assert.equal(destinationContext.checkoutAttempts[0].ticketTypeId, differentService.id);
});

test('native wallet URL changes preserve an earlier pending payment and actual recovery never starts another checkout', async () => {
  const storage = new Map();
  mocks['@dvnt/app/lib/mmkv-zustand'] = { mmkvStorage: {
    getItem: key => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, JSON.parse(JSON.stringify(value))),
    removeItem: key => storage.delete(key),
  } };
  const { useNativeTicketCheckoutStore: pendingStore, nativeTicketCheckoutKey } = loadNative(path.join(appRoot, 'lib/stores/native-ticket-checkout-store.ts'));
  const { completeNativeTicketCheckout } = loadNative(path.join(appRoot, 'lib/tickets/native-checkout-outcome.ts'));
  const key = nativeTicketCheckoutKey('synthetic-viewer', '42');
  const original = { paymentIntentId: 'pi_synthetic_original_admission', ticketTypeId: dbAdmission.id, quantity: 2 };
  pendingStore.getState().remember(key, original);
  await destination();
  let reads = 0;
  let payments = 0;
  const context = {
    eventData: destinationContext.eventData, eventId: '42', viewerId: 'synthetic-viewer', nativeCheckoutKey: key,
    useEventDetailScreenStore: nativeStore, useNativeTicketCheckoutStore: pendingStore,
    setIsCheckingOut: nativeStore.getState().setIsCheckingOut, setTicketQty: nativeStore.getState().setTicketQty,
    showToast: () => {}, promoCode: '', console,
    nativeCheckout: async () => { payments++; assert.fail('pending recovery must not initiate another payment'); },
    completeNativeTicketCheckout: input => completeNativeTicketCheckout({ ...input, wait: async () => {} }),
    ticketsApi: { getMyTickets: async () => { reads++; return []; } },
    qk: loadNative(path.join(appRoot, 'lib/query/keys.ts')).qk,
    eventKeys: { all: ['events'] }, queryClient: { invalidateQueries: () => {} },
  };
  function actualCallback(name) {
    const ast = ts.createSourceFile('callback.ts', 'const ' + nativeDeclarations.get(name) + ';', ts.ScriptTarget.Latest, true);
    const body = ast.statements[0].declarationList.declarations[0].initializer.arguments[0].getText(ast);
    return vm.runInNewContext(ts.transpileModule(`(${body});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context);
  }
  context.handleNativeTicketCheckout = actualCallback('handleNativeTicketCheckout');
  const recover = actualCallback('handleGetTickets');
  destinationContext.pendingNativeCheckout = pendingStore.getState().pending[key];
  destinationContext.entryHandler = () => {
    context.selectedTier = nativeStore.getState().selectedTier;
    context.ticketQty = nativeStore.getState().ticketQty;
    return recover();
  };
  for (const request of ['missing-service', dbService.id, undefined]) {
    destinationContext.requestedServiceTierId = request;
    await renderDestination();
    assert.equal(JSON.stringify(pendingStore.getState().pending[key]), JSON.stringify(original));
    assert.equal(additional(), undefined, 'original payment recovery has priority over the new selection');
    assert.ok(button('Check ticket status'));
  }
  await click(button('Check ticket status'));
  assert.equal(reads, 5, 'the actual outcome handler only polls original payment issuance');
  assert.equal(payments, 0);
  assert.equal(JSON.stringify(pendingStore.getState().pending[key]), JSON.stringify(original), 'a URL/quantity change cannot replace or clear the pending purchase');
  assert.deepEqual(destinationContext.checkoutAttempts, []);
  pendingStore.getState().clear(key);
});
