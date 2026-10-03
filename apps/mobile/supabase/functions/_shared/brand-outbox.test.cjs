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
  const welcome = outbox.campaignMessage('welcome_dm_v2');
  assert.match(welcome.body, /^Deviant announcement — automated\n\n/);
  assert.ok(welcome.body.includes('Welcome to the cookout! (The Black, Brown & Queer cookout aka B.B.Q.)'));
  assert.ok(!welcome.body.includes('Stop these messages'));
  const withLink = outbox.campaignMessage('first_post_v1', 'https://dvntapp.live/u/x');
  assert.equal(withLink.subject, 'Make your first DVNT post');
  assert.ok(withLink.body.includes('Stop these messages: https://dvntapp.live/u/x'));
  assert.equal(outbox.campaignMessage('welcome_dm_v9'), null);
});

// ── verifyBrandSender ───────────────────────────────────────────────────────
// The configured pair must name one real account. A well-formed id is not a
// correct id, and this app has already had content land under the wrong
// account once because an identity was taken on trust.
const BRAND = { userId: 613, authId: "brand-auth-id-fixture" };
const { verifyBrandSender } = sender(CONFIGURED);

function fakeDb(row) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => row }),
      }),
    }),
  };
}

test("the configured pair is accepted when it names one real account", async () => {
  const db = fakeDb({
    data: { id: 613, auth_id: "brand-auth-id-fixture", username: "deviantevents" },
  });
  const got = await verifyBrandSender(db, BRAND);
  assert.equal(got.ok, true);
  assert.equal(got.sender.userId, 613);
});

test("an auth id belonging to another account is refused, not sent as", async () => {
  // users.id 613 exists, but its auth_id is somebody else's — the exact shape
  // of the incident this guard exists for.
  const db = fakeDb({
    data: { id: 613, auth_id: "someone-elses-auth-id-fixture", username: "deviantevents" },
  });
  const got = await verifyBrandSender(db, BRAND);
  assert.equal(got.ok, false);
  assert.match(got.reason, /does not belong to/);
  // The real auth id must not be echoed back into logs beside the configured one.
  assert.ok(!got.reason.includes("someone-elses-auth-id-fixture"));
});

test("a missing account fails closed rather than defaulting to anyone", async () => {
  const got = await verifyBrandSender(fakeDb({ data: null }), BRAND);
  assert.equal(got.ok, false);
  assert.match(got.reason, /No account with users\.id 613/);
});

test("an unreadable users table sends nothing", async () => {
  const got = await verifyBrandSender(fakeDb({ error: new Error("boom") }), BRAND);
  assert.equal(got.ok, false);
});

// auth-sync calls enqueue_brand_onboarding with p_auth_id on every sign-in,
// including members who joined years ago. The lookback must bound that path
// too, or every returning member is "welcomed" again.
test("enqueue_brand_onboarding applies the lookback to the single-member path", () => {
  const sql = fs.readFileSync(
    `${__dirname}/../../migrations/20261001194000_deviantevents_onboarding_retention.sql`,
    'utf8',
  );
  const fn = sql.slice(
    sql.indexOf('FUNCTION public.enqueue_brand_onboarding'),
    sql.indexOf('FUNCTION public.claim_brand_messages'),
  );
  const recipients = fn.slice(fn.indexOf('recipients AS ('), fn.indexOf('rows_to_insert AS ('));
  const where = recipients.slice(recipients.indexOf('WHERE')).replace(/\s+/g, ' ');
  assert.match(where, /^WHERE u\.created_at >= now\(\) - p_lookback AND \(/);
  assert.ok(!/\)\s*OR\s*\(/.test(where), 'no OR branch may bypass the lookback');

  const authSync = fs.readFileSync(`${__dirname}/../auth-sync/index.ts`, 'utf8');
  assert.match(authSync, /enqueue_brand_onboarding[\s\S]{0,120}p_lookback: "7 days"/);
});

// The welcome email goes out directly from the auth function's
// user.create.after hook, as it did on master. The outbox only sends once the
// brand sender, unsubscribe URL and DVNT_BRAND_OUTBOX_ENABLED are configured,
// so routing the email through it meant new members got none. The outbox must
// not queue or render a second welcome email either.
const MIGRATION = `${__dirname}/../../migrations/20261001194000_deviantevents_onboarding_retention.sql`;

function createAfterHook() {
  const src = fs.readFileSync(`${__dirname}/../auth/index.ts`, 'utf8');
  const start = src.indexOf('after: async (user: any) => {');
  assert.ok(start > 0, 'user.create.after hook not found');
  return { src, hook: src.slice(start, src.indexOf('session: {', start)) };
}

test('signup sends the welcome email directly from user.create.after', () => {
  const { src, hook } = createAfterHook();
  assert.match(src, /welcome as welcomeEmail/);
  assert.match(hook, /welcomeEmail\(name\)/);
  assert.match(hook, /await sendEmail\(user\.email, subject, html\)/);
});

test('the outbox carries no second welcome email', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const fn = sql.slice(
    sql.indexOf('FUNCTION public.enqueue_brand_onboarding'),
    sql.indexOf('FUNCTION public.claim_brand_messages'),
  );
  assert.ok(!/welcome_email/.test(fn), 'enqueue_brand_onboarding must not queue a welcome email');
  assert.ok(!/'email'/.test(fn), 'enqueue_brand_onboarding must not queue any email row');
  assert.match(fn, /'welcome_dm_v2'/);
  assert.match(fn, /'first_post_v1'/);
  assert.equal(outbox.campaignMessage('welcome_email_v2', 'https://dvntapp.live/u/x'), null);
});

// R05: every eligible member follows @DeviantEvents, including members who
// joined before this shipped. The SQL behaviour (eligibility, idempotency,
// counts, the brand never following old members) is proven against a real
// Postgres by scripts/verify-brand-follows.mjs. These checks pin the wiring.
test('the brand-outbox cron runs the follow backfill in batches', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const worker = fs.readFileSync(`${__dirname}/../brand-outbox-worker/index.ts`, 'utf8');
  const sweep = sql.slice(sql.indexOf('FUNCTION public.cron_brand_outbox_sweep'));
  assert.match(sweep, /body := '\{"follow_backfill_limit":250\}'::jsonb/);
  assert.match(worker, /supabase\.rpc\("backfill_brand_follows", \{[\s\S]{0,160}p_limit: limit/);
  assert.match(worker, /Number\(body\.follow_backfill_limit\) \|\| 250/);
  // A failed backfill is reported in the response, not dropped.
  assert.match(worker, /return \{ status: "error", error:/);
  const responses = worker.match(/enqueued: enqueued \?\? 0,\s*brandFollows,/g) || [];
  assert.equal(responses.length, 3, 'every worker response must report brandFollows');
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.backfill_brand_follows\(integer, integer, interval\) TO service_role/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.backfill_brand_follows\(integer, integer, interval\) FROM PUBLIC, anon, authenticated/);
});

test('member -> brand has no signup window; brand -> member keeps one', () => {
  const sql = fs.readFileSync(MIGRATION, 'utf8');
  const fn = sql.slice(
    sql.indexOf('FUNCTION public.ensure_brand_follow_relationships'),
    sql.indexOf('FUNCTION public.backfill_brand_follows'),
  ).replace(/\s+/g, ' ');
  // The old early return skipped BOTH directions for anyone outside the window.
  assert.ok(!/v_member_created < now\(\) - p_lookback THEN RETURN/.test(fn));
  assert.match(fn, /IF p_bidirectional AND v_member_created IS NOT NULL AND v_member_created >= now\(\) - p_lookback THEN/);
});

// Profiles created outside auth-sync (resolveOrProvisionUser runs in 30+ edge
// functions) must get both directions too, without waiting for the cron.
test('every profile-creation path calls ensureBrandFollows', () => {
  const helper = fs.readFileSync(`${__dirname}/brand-follow.ts`, 'utf8');
  assert.match(helper, /ensure_brand_follow_relationships[\s\S]{0,200}p_lookback: NEW_PROFILE_WINDOW/);
  assert.match(helper, /NEW_PROFILE_WINDOW = "7 days"/);
  const authSync = fs.readFileSync(`${__dirname}/../auth-sync/index.ts`, 'utf8');
  assert.match(authSync, /await ensureBrandFollows\(supabaseAdmin, memberId, /);
  const resolveUser = fs.readFileSync(`${__dirname}/resolve-user.ts`, 'utf8');
  const provisioned = resolveUser.slice(resolveUser.indexOf('if (newRow) {'));
  assert.match(provisioned.slice(0, 600), /await ensureBrandFollows\(supabase, Number\(newRow\.id\), /);
});
