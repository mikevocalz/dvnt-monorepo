import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fixtures, templates } from './fixtures.mjs';
const { COLORS } = await import('./tokens.ts');
const components = await import('./components.ts');

function luminance(hex) {
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map(c => c + c).join('')}` : hex;
  const rgb = full.slice(1).match(/../g).map(c => parseInt(c, 16) / 255).map(c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4);
  return rgb[0] * .2126 + rgb[1] * .7152 + rgb[2] * .0722;
}
function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (values[0] + .05) / (values[1] + .05);
}
function css(style, key) { return new RegExp(`(?:^|;)\\s*${key}:([^;]+)`).exec(style)?.[1].trim(); }
function assertContrast(fg, bg, label) {
  assert.ok(fg && bg, `${label}: colors must be explicit`);
  assert.ok(contrast(fg, bg) >= 4.5, `${label}: ${fg} on ${bg} has contrast ${contrast(fg, bg).toFixed(2)}, requires 4.5`);
}
function assertLayoutTables(html) {
  // Generated templates have quoted attributes; strip comments/VML first.
  const tags = html.replace(/<!--[\s\S]*?-->/g, '').match(/<\/?[a-z][^>]*>/gi) || [];
  const stack = [];
  for (const tag of tags) {
    const [, close, raw] = /^<(\/?)([a-z0-9]+)/i.exec(tag);
    const name = raw.toLowerCase();
    if (close) { assert.equal(stack.pop(), name, `invalid nesting at ${tag}`); continue; }
    if (name === 'tr') assert.ok(['table', 'tbody', 'thead', 'tfoot'].includes(stack.at(-1)), `tr cannot be inside ${stack.at(-1)}`);
    if (name === 'td') assert.equal(stack.at(-1), 'tr', 'td must be inside tr');
    if (name === 'table') assert.match(tag, /role="presentation"/);
    if (!['img', 'meta', 'br', 'hr', 'link', 'input'].includes(name) && !tag.endsWith('/>')) stack.push(name);
  }
  assert.deepEqual(stack, []);
}

for (const [name, { html }] of Object.entries(fixtures)) {
  test(`${name}: actual rendered template uses dark shell and Gmail text protection`, () => {
    assert.match(html, /name="color-scheme" content="dark"/);
    assert.match(html, /name="supported-color-schemes" content="dark"/);
    assert.match(html, /<body[^>]*class="dvnt-body"/);
    assert.match(html, /u\s*\+\s*\.dvnt-body[^{}]*\{[^}]*mix-blend-mode:screen/);
    assert.match(html, /u\s*\+\s*\.dvnt-body[^{}]*\{[^}]*mix-blend-mode:difference/);
    for (const color of [COLORS.canvas, COLORS.panel]) {
      assert.ok(html.includes(`bgcolor="${color}"`), `${name} needs legacy bgcolor ${color}`);
      assert.ok(html.includes(`linear-gradient(${color},${color})`), `${name} needs protected ${color} background`);
    }
    assert.match(html, /<html[^>]*lang="en"[^>]*dir="ltr"/);
    assert.match(html, /<title>[^<]+<\/title>/);
    assertLayoutTables(html);
    assert.ok(Buffer.byteLength(html) < 102_400, 'avoid Gmail clipping');
  });
}

test('every exported email generator is represented by real fixtures', () => {
  assert.deepEqual(Object.keys(templates).filter(k => typeof templates[k] === 'function').sort(), [
    'accountLinked', 'broadcast', 'magicLinkEmail', 'payoutStatement', 'promoterInvite', 'resetPassword', 'ticketConfirmation', 'verificationCode', 'verifyEmail', 'verifyEmailLink', 'welcome',
  ].sort());
});

test('body, secondary, footer and link text meet WCAG AA on all dark surfaces', () => {
  for (const fg of [COLORS.text, COLORS.textBody, COLORS.textMuted, COLORS.textFaint, COLORS.cyan]) {
    for (const bg of [COLORS.canvas, COLORS.panel, COLORS.panelInset]) assertContrast(fg, bg, 'text token');
  }
});

test('button text has AA contrast across fallback and every gradient stop', () => {
  for (const gradient of ['brand', 'deviant']) {
    const html = components.button('https://example.test', 'Preview action', { gradient });
    const style = /<a[^>]*style="([^"]*)"/.exec(html)?.[1];
    assert.ok(style);
    const fg = css(style, 'color');
    const backgrounds = [css(style, 'background-color'), ...(css(style, 'background-image')?.match(/#[a-f\d]{6}/gi) || [])];
    for (const bg of backgrounds) assertContrast(fg, bg, `${gradient} button`);
  }
});

test('all tier badges including comp and unknown labels remain readable', () => {
  for (const tier of ['free', 'ga', 'vip', 'table', 'comp', 'INFLUENCER']) {
    const html = components.tierBadge(tier);
    const style = /<span[^>]*style="([^"]*)"/.exec(html)?.[1];
    assert.ok(style);
    const fg = css(style, 'color');
    const backgrounds = [css(style, 'background-color'), ...(css(style, 'background-image')?.match(/#[a-f\d]{6}/gi) || [])];
    for (const bg of backgrounds) assertContrast(fg, bg, `${tier} badge`);
  }
});

test('transfer screenshot branch preserves content and app destination without adding a QR', () => {
  const { html, subject } = fixtures.transfer;
  assert.equal(subject, 'Your ticket for Preview “Night Out”');
  for (const text of ['INFLUENCER', 'View in app', '@preview_host']) {
    assert.ok(html.includes(text));
  }
  assert.match(html, /You(?:'|&#39;)re in/);
  assert.ok(html.includes('href="https://example.test/action?token=preview-only&amp;source=email"'));
  assert.doesNotMatch(html, /api\.qrserver\.com/);
});

test('QR remains an untouched image with a white quiet-zone backing and encoded token', () => {
  const { html } = fixtures.guest;
  const qr = html.match(/<img[^>]*api\.qrserver\.com[^>]*>/)?.[0];
  assert.ok(qr);
  assert.match(qr, /background(?:-color)?:#fff(?:fff)?/i);
  assert.match(qr, /padding:8px/);
  assert.ok(qr.includes(encodeURIComponent('PREVIEW-ONLY-QR<&>')));
  assert.ok(html.includes('Guest preview &lt;special&gt; &amp; friends'));
  assert.doesNotMatch(qr, /mix-blend-mode/);
});

test('follow-up unsubscribe destination, exact copy and one-click headers are retained', () => {
  const { html, headers } = fixtures.followup;
  assert.ok(html.includes('Unsubscribe from event follow-up emails'));
  assert.ok(html.includes('https://example.test/unsubscribe?token=preview-only'));
  assert.equal(headers['List-Unsubscribe'], '<https://example.test/unsubscribe?token=preview-only>');
  assert.equal(headers['List-Unsubscribe-Post'], 'List-Unsubscribe=One-Click');
  assert.ok(html.includes('Thanks for coming.'));
  assert.ok(html.includes('See you next time.'));
});

// These content-only snapshots were captured from master 91045fb0, before the
// style changes. Keep text, subject, destinations and QR payloads unchanged.
const contentSnapshot = JSON.parse(readFileSync(new URL('./content.snapshot.json', import.meta.url), 'utf8'));
for (const [name, expected] of Object.entries(contentSnapshot)) {
  test(`${name}: styling preserves pre-fix copy, subjects, links and image payloads`, () => {
    const { html, subject } = fixtures[name];
    const body = /<body[^>]*>([\s\S]*)<\/body>/.exec(html)?.[1] || html;
    const text = body.replace(/<!--[\s\S]*?-->/g, '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    const links = [...html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<a[^>]+href="([^"]+)"/g)].map(x => x[1]);
    const images = [...html.matchAll(/<img[^>]+src="([^"]+)"/g)].map(x => x[1]);
    assert.deepEqual({ subject, text, links, images }, expected);
  });
}

test('logos, flyers and QR images never enter a Gmail text-blending wrapper', () => {
  for (const [name, { html }] of Object.entries(fixtures)) {
    const stack = [];
    for (const tag of html.replace(/<!--[\s\S]*?-->/g, '').match(/<\/?[a-z][^>]*>/gi) || []) {
      const [, close, raw] = /^<(\/?)([a-z0-9]+)/i.exec(tag);
      const element = raw.toLowerCase();
      if (close) { stack.pop(); continue; }
      if (element === 'img') assert.ok(!stack.some(t => /class="dvnt-blend-/.test(t)), `${name}: image must not be color-blended`);
      if (!['img', 'meta', 'br', 'hr', 'link', 'input'].includes(element) && !tag.endsWith('/>')) stack.push(tag);
    }
  }
});

test('Outlook fixed-width fallback and narrow-screen override remain paired', () => {
  assert.match(fixtures.transfer.html, /class="dvnt-card"[^>]*width="600"[^>]*style="width:600px;max-width:600px/);
  assert.match(fixtures.transfer.html, /max-width:600px\)\{\.dvnt-card\{width:100%!important/);
});

test('QR scan margin is protected white without blending the credential image', () => {
  const qr = fixtures.guest.html.match(/<img[^>]*alt="QR code"[^>]*>/)?.[0];
  assert.ok(qr);
  assert.match(qr, /background-color:#ffffff;background-image:linear-gradient\(#ffffff,#ffffff\)/);
});


test('verification and reminder add-on emails remain dark-only, never opt into light templates', () => {
  for (const name of ['verification', 'verifyLink', 'reminderAddons']) {
    const {html} = fixtures[name];
    assert.match(html, /<body[^>]*bgcolor="#0a0a0a"/);
    assert.match(html, /name="color-scheme" content="dark"/);
    assert.doesNotMatch(html, /(?:color-scheme[^;>]*light|prefers-color-scheme:\s*light)/i);
    assert.match(html, /background-image:linear-gradient\(#0a0a0a,#0a0a0a\)/);
    assertLayoutTables(html);
  }
  assert.match(fixtures.reminderAddons.html, /Your add-ons/);
  assert.match(fixtures.reminderAddons.html, /Separate coat check × 2/);
});
