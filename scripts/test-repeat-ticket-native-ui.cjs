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
