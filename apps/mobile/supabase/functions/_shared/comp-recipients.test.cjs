const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

// Same realm as the test, not vm.runInNewContext: a cross-realm object fails
// assert.deepEqual on prototype identity even when the shape matches.
function load() {
  const source = ts.transpileModule(fs.readFileSync(`${__dirname}/comp-recipients.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const mod = { exports: {} };
  new Function('exports', 'module', source)(mod.exports, mod);
  return mod.exports;
}
const { routeCompRecipient, summarizeCompDelivery } = load();

const ACCOUNT = { authId: 'auth-deviant' };

test('a username or email that resolves to an account takes the in-app path', () => {
  assert.deepEqual(routeCompRecipient('@deviant', ACCOUNT), { route: 'member' });
  assert.deepEqual(routeCompRecipient('Deviant@Example.com', ACCOUNT), { route: 'member' });
});

test('an email with no account becomes a guest comp, lowercased', () => {
  assert.deepEqual(routeCompRecipient('  Guest@Example.COM ', null), {
    route: 'guest',
    email: 'guest@example.com',
  });
});

test('a username with no account is skipped — a handle is not an address', () => {
  const route = routeCompRecipient('@nobody', null);
  assert.equal(route.route, 'skip');
  assert.match(route.reason, /use their email/i);
});

test('a phone number is skipped and the reason names the missing SMS path', () => {
  for (const input of ['+1 (415) 555-0134', '4155550134']) {
    const route = routeCompRecipient(input, null);
    assert.equal(route.route, 'skip');
    assert.match(route.reason, /SMS consent record/);
    assert.doesNotMatch(route.reason, /phone delivery is not available/);
  }
});

test('junk input is skipped without being mistaken for a phone number', () => {
  const route = routeCompRecipient('not an address', null);
  assert.deepEqual(route, {
    route: 'skip',
    reason: 'Not a DVNT username or a valid email address',
  });
});

test('a resolved account beats the guest path even when the input is an email', () => {
  assert.equal(routeCompRecipient('guest@example.com', { authId: null }).route, 'guest');
  assert.equal(routeCompRecipient('guest@example.com', { authId: 'u1' }).route, 'member');
});

test('issued is not delivered: a failed send is reported, never counted as delivered', () => {
  const summary = summarizeCompDelivery([
    { recipient: 'a@example.com', delivered: true },
    { recipient: 'b@example.com', delivered: false, error: 'Resend 422: invalid address' },
    { recipient: 'c@example.com', delivered: false },
  ]);
  assert.equal(summary.delivered, 1);
  assert.equal(summary.failed, 2);
  assert.deepEqual(summary.results[0], { recipient: 'a@example.com', status: 'delivered' });
  assert.equal(summary.results[1].status, 'failed');
  assert.equal(summary.results[1].error, 'Resend 422: invalid address');
  assert.equal(summary.results[2].error, 'Email delivery failed');
  // A delivered row carries no error string the host could misread as a problem.
  assert.equal('error' in summary.results[0], false);
});

test('no guest sends means no delivery claims at all', () => {
  assert.deepEqual(summarizeCompDelivery([]), { delivered: 0, failed: 0, results: [] });
});
