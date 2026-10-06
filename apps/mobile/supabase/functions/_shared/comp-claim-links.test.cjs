const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

function load() {
  const source = ts.transpileModule(fs.readFileSync(`${__dirname}/comp-claim-links.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'module', source)(mod.exports, mod);
  return mod.exports;
}
const { compClaimUrl, toCompClaimLink, claimRefusal, isClaimToken } = load();

const TOKEN = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJ-_01234';

test('claim URL lives under /ticket/claim on the site domain', () => {
  assert.equal(TOKEN.length, 43);
  assert.equal(compClaimUrl('https://dvntapp.live/', TOKEN), `https://dvntapp.live/ticket/claim/${TOKEN}`);
  assert.equal(compClaimUrl('https://dvntapp.live', TOKEN), `https://dvntapp.live/ticket/claim/${TOKEN}`);
});

test('a token that is not 43 base64url characters never becomes a link', () => {
  for (const bad of ['', 'short', `${TOKEN}x`, TOKEN.replace('-', '+'), TOKEN.replace('a', '/'), null]) {
    assert.equal(isClaimToken(bad), false);
    assert.throws(() => compClaimUrl('https://dvntapp.live', bad));
  }
});

test('the host gets the typed recipient back next to the normalized phone', () => {
  const link = toCompClaimLink(
    { ticket_id: 't1', phone: '+14155550134', token: TOKEN, expires_at: '2026-10-10T00:00:00Z', reissued: true },
    '(415) 555-0134',
    'https://dvntapp.live',
  );
  assert.deepEqual(link, {
    recipient: '(415) 555-0134',
    phone: '+14155550134',
    ticket_id: 't1',
    url: `https://dvntapp.live/ticket/claim/${TOKEN}`,
    expires_at: '2026-10-10T00:00:00Z',
    reissued: true,
  });
  assert.equal(JSON.stringify(link).includes('"token"'), false);
});

test('every claim refusal maps to a status and copy; unknown codes read as an invalid link', () => {
  assert.equal(claimRefusal('claimed_by_other').status, 409);
  assert.equal(claimRefusal('expired').status, 410);
  assert.equal(claimRefusal('ticket_unavailable').status, 410);
  assert.equal(claimRefusal('unauthenticated').status, 401);
  assert.deepEqual(
    { status: claimRefusal('anything').status, code: claimRefusal('anything').code },
    { status: 404, code: 'invalid_token' },
  );
});
