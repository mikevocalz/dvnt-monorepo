const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Loads an edge-function module under a fake Deno global so env reads can be
// driven from the test. Same shape as create-event/index.test.cjs.
function load(file, env = {}) {
  const source = ts.transpileModule(
    fs.readFileSync(`${__dirname}/${file}`, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const exports = {};
  vm.runInNewContext(source, {
    exports,
    console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: (name) => env[name] } },
  });
  return exports;
}

// The modules run in their own vm context, so their objects do not share this
// realm's prototypes. Compare values, not identity.
const deepEq = (actual, expected, message) =>
  assert.deepEqual(JSON.parse(JSON.stringify(actual ?? null)), expected, message);

const outbox = load('brand-outbox.ts');
const sender = (env) => load('brand-sender.ts', env);

const CONFIGURED = {
  DVNT_BRAND_USER_ID: '42',
  DVNT_BRAND_AUTH_ID: 'brand-auth-id',
  DVNT_BRAND_OUTBOX_ENABLED: 'true',
};

test('the provider idempotency key is the unique key, so a retry cannot become a second message', () => {
  const key = outbox.providerIdempotencyKey('welcome_dm_v1', 7, 'dm');
  assert.equal(key, 'welcome_dm_v1:7:dm');
  assert.equal(key, outbox.providerIdempotencyKey('welcome_dm_v1', 7, 'dm'));
  // Every component of (campaign_version, recipient_id, channel) moves the key.
  assert.notEqual(key, outbox.providerIdempotencyKey('welcome_dm_v2', 7, 'dm'));
  assert.notEqual(key, outbox.providerIdempotencyKey('welcome_dm_v1', 8, 'dm'));
  assert.notEqual(key, outbox.providerIdempotencyKey('welcome_dm_v1', 7, 'email'));
});

test('a queued row only moves by being claimed', () => {
  deepEq(outbox.transition('queued', 'claim'), { state: 'sending', retryable: false });
  assert.equal(outbox.transition('queued', 'delivered'), null);
  assert.equal(outbox.transition('queued', 'transient_error'), null);
  assert.equal(outbox.transition('queued', 'permanent_error'), null);
});

test('a claimed row settles on delivery or on a permanent error', () => {
  deepEq(outbox.transition('sending', 'delivered'), { state: 'sent', retryable: false });
  deepEq(outbox.transition('sending', 'permanent_error'), { state: 'failed', retryable: false });
  assert.equal(outbox.transition('sending', 'claim'), null);
});

test('a transient error returns to queued until the attempt cap, then fails', () => {
  for (let attempt = 1; attempt < outbox.MAX_ATTEMPTS; attempt += 1) {
    deepEq(
      outbox.transition('sending', 'transient_error', attempt),
      { state: 'queued', retryable: true },
      `attempt ${attempt}`,
    );
  }
  deepEq(
    outbox.transition('sending', 'transient_error', outbox.MAX_ATTEMPTS),
    { state: 'failed', retryable: false },
  );
});

test('suppression stops a row from either live state', () => {
  deepEq(outbox.transition('queued', 'suppress'), { state: 'suppressed', retryable: false });
  deepEq(outbox.transition('sending', 'suppress'), { state: 'suppressed', retryable: false });
});

test('sent, failed and suppressed are terminal — no event reopens them', () => {
  for (const state of ['sent', 'failed', 'suppressed']) {
    for (const event of ['claim', 'delivered', 'transient_error', 'permanent_error', 'suppress']) {
      assert.equal(outbox.transition(state, event), null, `${state} + ${event}`);
    }
  }
});

test('sending fails closed when the canonical sender is not configured', () => {
  const cases = [
    [{}, 'DVNT_BRAND_USER_ID is not set'],
    [{ DVNT_BRAND_AUTH_ID: 'a', DVNT_BRAND_OUTBOX_ENABLED: 'true' }, 'DVNT_BRAND_USER_ID is not set'],
    [{ DVNT_BRAND_USER_ID: '42', DVNT_BRAND_OUTBOX_ENABLED: 'true' }, 'DVNT_BRAND_AUTH_ID is not set'],
    [{ ...CONFIGURED, DVNT_BRAND_USER_ID: '  ' }, 'DVNT_BRAND_USER_ID is not set'],
    [{ ...CONFIGURED, DVNT_BRAND_USER_ID: 'DeviantEvents' }, 'DVNT_BRAND_USER_ID is not a positive integer'],
    [{ ...CONFIGURED, DVNT_BRAND_USER_ID: '0' }, 'DVNT_BRAND_USER_ID is not a positive integer'],
    [{ ...CONFIGURED, DVNT_BRAND_USER_ID: '-1' }, 'DVNT_BRAND_USER_ID is not a positive integer'],
  ];
  for (const [env, reason] of cases) {
    const gate = sender(env).brandSendGate();
    assert.equal(gate.ok, false, JSON.stringify(env));
    assert.equal(gate.reason, reason);
    assert.equal(gate.sender, undefined);
  }
});

test('resolved IDs alone do not enable sending — the flag is a separate decision', () => {
  const ids = { DVNT_BRAND_USER_ID: '42', DVNT_BRAND_AUTH_ID: 'brand-auth-id' };
  deepEq(sender(ids).resolveBrandSender(), {
    ok: true,
    sender: { userId: 42, authId: 'brand-auth-id' },
  });
  for (const flag of [undefined, '', 'false', 'TRUE', '1', 'yes']) {
    const gate = sender({ ...ids, DVNT_BRAND_OUTBOX_ENABLED: flag }).brandSendGate();
    assert.equal(gate.ok, false, `flag=${flag}`);
    assert.equal(gate.reason, 'DVNT_BRAND_OUTBOX_ENABLED is not true');
  }
  const open = sender(CONFIGURED).brandSendGate();
  assert.equal(open.ok, true);
  deepEq(open.sender, { userId: 42, authId: 'brand-auth-id' });
});

test('growth email stays shut until an unsubscribe URL exists', () => {
  assert.equal(sender(CONFIGURED).brandUnsubscribeUrl(), null);
  assert.equal(
    sender({ ...CONFIGURED, DVNT_BRAND_UNSUBSCRIBE_URL: 'https://dvntapp.live/u/x' }).brandUnsubscribeUrl(),
    'https://dvntapp.live/u/x',
  );
});

test('brand copy is labelled automated and an unknown campaign version sends nothing', () => {
  const welcome = outbox.campaignMessage('welcome_dm_v1');
  assert.match(welcome.body, /^Deviant announcement — automated\n\n/);
  assert.ok(welcome.body.includes('Welcome to the cookout! The Black Queer cookout.'));
  assert.ok(!welcome.body.includes('Stop these messages'));
  const withLink = outbox.campaignMessage('first_post_v1', 'https://dvntapp.live/u/x');
  assert.ok(withLink.body.includes('Stop these messages: https://dvntapp.live/u/x'));
  assert.equal(outbox.campaignMessage('welcome_dm_v9'), null);
});
