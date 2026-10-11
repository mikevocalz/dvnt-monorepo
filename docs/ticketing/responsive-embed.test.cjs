const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.join(__dirname, 'previews');
const widget = fs.readFileSync(path.join(root, 'widget-responsive.html'), 'utf8');
const parent = fs.readFileSync(path.join(root, 'embed-responsive.html'), 'utf8');

test('wide embed switches into the native DVNT two-pane layout', () => {
  assert.match(widget, /@media\(min-width:740px\)/);
  assert.match(widget, /grid-template-columns:minmax\(0,\.88fr\) minmax\(0,1fr\)/);
  assert.match(widget, /class="flyer-pane"/);
  assert.match(widget, /class="checkout-pane"/);
});
test('narrow iframe uses stacked compact layout and avoids fixed 550px card', () => {
  assert.match(widget, /@media\(max-width:400px\)/);
  assert.match(widget, /grid-template-columns:minmax\(0,1fr\)/);
  assert.match(widget, /max-width:1100px/);
  assert.match(widget, /\.buyer\{grid-template-columns:1fr\}/);
});
test('both brand placements use the exact repository SVG paths', () => {
  assert.equal((widget.match(/aria-label="DVNT"/g) || []).length, 2);
  assert.match(widget, /viewBox="0 0 2360 908"/);
  assert.match(widget, /top:12px/);
  assert.match(widget, /Powered by/);
  assert.match(widget, /id="footer-wg"/);
  assert.match(widget, /url\(#footer-wg\)/);
});
test('iframe parent offers responsive widths and bounded resize messages', () => {
  for (const width of ['100%', '760px', '390px', '320px']) {
    assert.ok(parent.includes('data-preview-width="' + width + '"'));
  }
  assert.match(parent, /event\.source!==frame\.contentWindow/);
  assert.match(parent, /event\.origin!=='null'/);
  assert.match(parent, /Number\.isFinite\(data\.height\)/);
  assert.match(parent, /Math\.min\(3000/);
});
test('demo is offline and cannot collect payment data', () => {
  assert.match(widget, /connect-src 'none'/);
  assert.match(widget, /form-action 'none'/);
  assert.match(widget, /No payment was taken/);
  assert.match(widget, /Stripe payment area/);
});

// Execute the checked-in parent script with a small DOM double, not a copied
// resize algorithm. These are handler tests, not browser/layout or payment tests.
function parentHarness() {
  const frame = { contentWindow: {}, style: { height: '950px', width: '100%' } };
  const buttons = [...parent.matchAll(/data-preview-width="([^"]+)"/g)].map((match) => {
    const attributes = new Map([['data-preview-width', match[1]]]);
    const listeners = new Map();
    return {
      getAttribute: (name) => attributes.get(name),
      setAttribute: (name, value) => attributes.set(name, value),
      addEventListener: (name, listener) => listeners.set(name, listener),
      click: () => {
        assert.ok(listeners.has('click'), 'Width button must have a click handler');
        listeners.get('click')();
      },
    };
  });
  const listeners = new Map();
  const document = {
    getElementById(id) {
      assert.equal(id, 'ticket-demo');
      return frame;
    },
    querySelectorAll(selector) {
      assert.equal(selector, '[data-preview-width]');
      return buttons;
    },
    querySelector(selector) {
      assert.equal(selector, '[data-preview-width]');
      return buttons[0];
    },
  };
  const scripts = [...parent.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1, 'Expected the actual inline parent script');
  vm.runInNewContext(scripts[0][1], {
    document,
    window: { addEventListener: (name, listener) => listeners.set(name, listener) },
  }, { timeout: 1000 });
  assert.equal(typeof listeners.get('message'), 'function');
  return { frame, buttons, dispatch: (event) => listeners.get('message')(event) };
}

test('both SVGs have unique IDs and resolve every gradient within their own logo', () => {
  const logos = widget.match(/<svg\b[^>]*aria-label="DVNT"[^>]*>[\s\S]*?<\/svg>/g) || [];
  assert.equal(logos.length, 2);
  const allIds = [];
  for (const logo of logos) {
    const ids = [...logo.matchAll(/\bid="([^"]+)"/g)].map((match) => match[1]);
    assert.equal(ids.length, 6, 'Each wordmark defines six gradients');
    const paints = [...logo.matchAll(/url\(#([^)]+)\)/g)].map((match) => match[1]);
    const inherited = [...logo.matchAll(/(?:xlink:)?href="#([^"]+)"/g)].map((match) => match[1]);
    assert.equal(paints.length, 6, 'All six colored paths must retain a gradient');
    assert.equal(inherited.length, 4, 'Inherited gradients must remain linked');
    for (const reference of [...paints, ...inherited]) {
      assert.ok(ids.includes(reference), `Unresolved or cross-logo gradient: ${reference}`);
    }
    allIds.push(...ids);
  }
  assert.equal(new Set(allIds).size, allIds.length, 'Header and footer IDs must not collide');
  assert.equal(logos[1].replaceAll('footer-wg', 'wg'), logos[0], 'Logo geometry and colors must stay identical');
});

test('actual resize handler rounds and clamps valid messages to 450 through 3000 pixels', () => {
  const h = parentHarness();
  for (const [height, expected] of [
    [-100, '450px'], [0, '450px'], [449, '450px'], [450, '450px'],
    [450.1, '451px'], [800.2, '801px'], [3000, '3000px'], [99999, '3000px'],
    [Number.MAX_VALUE, '3000px'], [600, '600px'],
  ]) {
    h.dispatch({ source: h.frame.contentWindow, origin: 'null', data: { type: 'dvnt-demo-height', height } });
    assert.equal(h.frame.style.height, expected, `Unexpected sizing for ${height}`);
    assert.equal(h.frame.style.width, '100%', 'Height messages must not change width');
  }
});

test('actual resize handler rejects foreign windows and non-opaque origins', () => {
  const h = parentHarness();
  const data = { type: 'dvnt-demo-height', height: 1200 };
  for (const event of [
    { source: {}, origin: 'null', data },
    { source: null, origin: 'null', data },
    { source: h.frame.contentWindow, origin: 'https://example.com', data },
    { source: h.frame.contentWindow, origin: '', data },
  ]) {
    h.dispatch(event);
    assert.equal(h.frame.style.height, '950px', 'Untrusted message changed the iframe');
  }
});

test('actual resize handler rejects malformed payloads and non-finite or non-numeric heights', () => {
  const h = parentHarness();
  const invalidData = [
    null, undefined, 'dvnt-demo-height', 900, [], {},
    { type: 'other-message', height: 1200 },
    ...[undefined, null, true, '1200', {}, [], NaN, Infinity, -Infinity].map(
      (height) => ({ type: 'dvnt-demo-height', height }),
    ),
  ];
  for (const data of invalidData) {
    h.dispatch({ source: h.frame.contentWindow, origin: 'null', data });
    assert.equal(h.frame.style.height, '950px', 'Malformed message changed the iframe');
  }
});

test('actual width controls change only iframe width and maintain one selected button', () => {
  const h = parentHarness();
  assert.equal(h.buttons.length, 4);
  assert.equal(h.buttons[0].getAttribute('aria-pressed'), 'true');
  for (const button of h.buttons) {
    button.click();
    assert.equal(h.frame.style.width, button.getAttribute('data-preview-width'));
    assert.equal(h.frame.style.height, '950px');
    for (const candidate of h.buttons) {
      assert.equal(candidate.getAttribute('aria-pressed'), String(candidate === button));
    }
  }
});
