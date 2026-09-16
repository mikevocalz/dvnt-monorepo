const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Same harness as brand-outbox.test.cjs: transpile the edge-function module and
// run it under a fake Deno global so env reads come from the test.
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

const bf = load('verification-backfill.ts');

// ── Dry run is the default ─────────────────────────────────────────────
// 1113 accounts are queued behind this. Only an explicit `false` sends.

test('a run sends nothing unless the body says dry_run: false', () => {
  assert.equal(bf.resolvePlan({}).dryRun, true, 'empty body');
  assert.equal(bf.resolvePlan().dryRun, true, 'no body at all');
  assert.equal(bf.resolvePlan({ dry_run: true }).dryRun, true);
  assert.equal(bf.resolvePlan({ dry_run: undefined }).dryRun, true);
  assert.equal(bf.resolvePlan({ dry_run: null }).dryRun, true);
  // A JSON string is a typo, not consent.
  assert.equal(bf.resolvePlan({ dry_run: 'false' }).dryRun, true, 'string "false"');
  assert.equal(bf.resolvePlan({ dry_run: 0 }).dryRun, true, 'zero');
  assert.equal(bf.resolvePlan({ dry_run: false }).dryRun, false, 'the one sending form');
});

// ── The ceiling ────────────────────────────────────────────────────────

test('no single invocation can attempt the whole list', () => {
  assert.equal(bf.resolvePlan({}).limit, bf.DEFAULT_LIMIT);
  assert.equal(bf.resolvePlan({ limit: 1113 }).limit, bf.MAX_LIMIT);
  assert.equal(bf.resolvePlan({ limit: 1e9 }).limit, bf.MAX_LIMIT);
  assert.ok(bf.MAX_LIMIT < 1113, 'the ceiling has to be below the backlog');
  // Below the floor and outright garbage both land somewhere legal.
  assert.equal(bf.resolvePlan({ limit: 0 }).limit, 1);
  assert.equal(bf.resolvePlan({ limit: -50 }).limit, 1);
  assert.equal(bf.resolvePlan({ limit: 'all of them' }).limit, bf.DEFAULT_LIMIT);
  assert.equal(bf.resolvePlan({ limit: 7.9 }).limit, 7, 'floored, never rounded up');
});

// ── Throttle ───────────────────────────────────────────────────────────

test('batch size and delay come from the environment, and the body overrides them', () => {
  assert.equal(bf.resolvePlan({}).batchSize, bf.DEFAULT_BATCH_SIZE);
  assert.equal(bf.resolvePlan({}).batchDelayMs, bf.DEFAULT_BATCH_DELAY_MS);

  const env = { DVNT_VERIFY_BACKFILL_BATCH_SIZE: '2', DVNT_VERIFY_BACKFILL_DELAY_MS: '9000' };
  assert.equal(bf.resolvePlan({}, env).batchSize, 2);
  assert.equal(bf.resolvePlan({}, env).batchDelayMs, 9000);
  assert.equal(bf.resolvePlan({ batch_size: 1, batch_delay_ms: 30000 }, env).batchSize, 1);
  assert.equal(bf.resolvePlan({ batch_size: 1, batch_delay_ms: 30000 }, env).batchDelayMs, 30000);

  // A nonsense env value falls back rather than disabling the throttle.
  assert.equal(bf.resolvePlan({}, { DVNT_VERIFY_BACKFILL_DELAY_MS: 'slow' }).batchDelayMs,
    bf.DEFAULT_BATCH_DELAY_MS);
  assert.equal(bf.resolvePlan({ batch_size: 500 }).batchSize, bf.MAX_BATCH_SIZE);
  assert.equal(bf.resolvePlan({ batch_delay_ms: -1 }).batchDelayMs, 0);
});

// The module runs in its own vm context, so its arrays do not share this
// realm's prototypes. Compare values, not identity — same as brand-outbox.test.
const deepEq = (actual, expected, message) =>
  assert.deepEqual(JSON.parse(JSON.stringify(actual ?? null)), expected, message);

test('rows split into batches in order, with no empty tail', () => {
  deepEq(bf.batches([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
  deepEq(bf.batches([1, 2, 3, 4], 2), [[1, 2], [3, 4]]);
  deepEq(bf.batches([], 4), []);
  deepEq(bf.batches([1, 2], 99), [[1, 2]]);
  // A zero width would loop forever, so it is treated as one.
  deepEq(bf.batches([1, 2], 0), [[1], [2]]);
});

test('the first batch goes out immediately and every later one waits', () => {
  assert.equal(bf.batchDelayMs(0, 2500), 0);
  assert.equal(bf.batchDelayMs(1, 2500), 2500);
  assert.equal(bf.batchDelayMs(9, 2500), 2500);
  assert.equal(bf.batchDelayMs(-1, 2500), 0);

  // N batches wait (N-1) delays, not N.
  assert.equal(bf.throttleBudgetMs(0, 4, 2500), 0);
  assert.equal(bf.throttleBudgetMs(4, 4, 2500), 0, 'one batch waits for nothing');
  assert.equal(bf.throttleBudgetMs(5, 4, 2500), 2500);
  assert.equal(bf.throttleBudgetMs(25, 4, 2500), 15000);
  // The ceiling has to stay inside the edge-function wall clock.
  assert.ok(bf.throttleBudgetMs(bf.MAX_LIMIT, bf.DEFAULT_BATCH_SIZE, bf.DEFAULT_BATCH_DELAY_MS)
    < 120000);
});

test('the default throttle stays under Resend\'s 2 requests per second', () => {
  assert.ok(bf.sendsPerSecond(bf.DEFAULT_BATCH_SIZE, bf.DEFAULT_BATCH_DELAY_MS) <= 2,
    `default rate was ${bf.sendsPerSecond(bf.DEFAULT_BATCH_SIZE, bf.DEFAULT_BATCH_DELAY_MS)}/s`);
  assert.equal(bf.sendsPerSecond(4, 2000), 2);
  assert.equal(bf.sendsPerSecond(4, 0), Infinity, 'no delay is no throttle');
});

test('a reported address never carries the whole local part', () => {
  assert.equal(bf.maskEmail('deviant.member@example.com'), 'de***@example.com');
  assert.equal(bf.maskEmail('a@example.com'), 'a***@example.com');
  assert.equal(bf.maskEmail('not-an-address'), '***');
  assert.equal(bf.maskEmail(''), '***');
});

// ── Skip rules ─────────────────────────────────────────────────────────
// The rules run in Postgres, inside verification_backfill_skip_reason, because
// they read public."user" and the outbox in the same statement that claims.
//
// ponytail: this asserts on the shipped SQL text rather than executing it. The
// ceiling is that a rename of the function or a reason string is caught, but a
// logic error inside a predicate is not — that needs a Postgres instance, and
// this repo's test lane has none. Re-point this at pg-mem or a real database
// when one exists.
const MIGRATION = fs.readFileSync(
  `${__dirname}/../../migrations/20260917000000_verification_email_backfill.sql`,
  'utf8',
);

test('an account that has since verified is skipped, not mailed again', () => {
  const fn = MIGRATION.split('CREATE OR REPLACE FUNCTION public.verification_backfill_skip_reason')[1]
    .split('CREATE OR REPLACE FUNCTION')[0];
  assert.match(fn, /"emailVerified" IS TRUE/, 'reads the live verified flag');
  assert.match(fn, /THEN 'already_verified'/);
  assert.match(fn, /THEN 'account_missing'/, 'a deleted account is not mailed');
});

test('an account mailed inside the cooldown is skipped, across every campaign version', () => {
  const fn = MIGRATION.split('CREATE OR REPLACE FUNCTION public.verification_backfill_skip_reason')[1]
    .split('CREATE OR REPLACE FUNCTION')[0];
  assert.match(fn, /s\.state = 'sent'/);
  assert.match(fn, /s\.sent_at >= now\(\) - p_cooldown/);
  assert.match(fn, /THEN 'mailed_recently'/);
  // Keyed on the account only. A v2 run must not re-mail a v1 recipient.
  assert.doesNotMatch(fn, /s\.campaign_version/,
    'the recency check must not be scoped to one campaign version');
});

test('the dry run and the real claim apply the same skip rules', () => {
  const claim = MIGRATION.split('CREATE OR REPLACE FUNCTION public.claim_verification_backfill')[1];
  const [preview, real] = claim.split('RETURN QUERY\n  UPDATE');
  assert.match(preview, /IF p_dry_run THEN/);
  // Both branches call the one definition, so the preview cannot drift from
  // what actually gets mailed.
  assert.equal(
    (claim.match(/public\.verification_backfill_skip_reason\(q\.auth_user_id, p_cooldown\)/g) || []).length,
    2,
    'preview and suppression each call the shared skip function exactly once',
  );
  assert.match(real, /FOR UPDATE SKIP LOCKED/, 'two runs cannot claim one row');
  assert.match(claim, /p_dry_run boolean DEFAULT true/, 'the SQL default is dry too');
});
