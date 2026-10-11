const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
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
});
test('iframe parent offers responsive widths and bounded resize messages', () => {
  for (const width of ['100%', '760px', '390px', '320px']) {
    assert.ok(parent.includes('data-preview-width="' + width + '"'));
  }
  assert.match(parent, /event\.source!==frame\.contentWindow/);
  assert.match(parent, /event\.origin!=='null'/);
  assert.match(parent, /Number\.isFinite\(data\.height\)/);
  assert.match(parent, /Math\.min\(1400/);
});
test('demo is offline and cannot collect payment data', () => {
  assert.match(widget, /connect-src 'none'/);
  assert.match(widget, /form-action 'none'/);
  assert.match(widget, /No payment was taken/);
  assert.match(widget, /Stripe payment area/);
});
