const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

// Test-generated strings are syntax fixtures, not real Stripe credentials.
const key = (prefix, mode) => `${prefix}_${mode}_${'A'.repeat(32)}`;
const valid = (mode = 'test') => ({
  STRIPE_SECRET_KEY: key('sk', mode),
  STRIPE_PUBLISHABLE_KEY: key('pk', mode),
  PUBLIC_SITE_URL: mode === 'test' ? 'https://staging.example.com' : 'https://dvntapp.live',
  TICKET_EMBED_PAYMENTS_ENABLED: 'true',
  SUPABASE_URL: 'https://staging-db.example.com',
  SUPABASE_SERVICE_ROLE_KEY: 'local-database-fixture',
});
function load(file, mocks = {}, deno = undefined) {
  const { outputText, diagnostics } = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }, reportDiagnostics: true,
  });
  assert.equal(diagnostics.filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  const module = { exports: {} };
  const requireLocal = (name) => {
    if (Object.hasOwn(mocks, name)) return mocks[name];
    assert.ok(name.startsWith('.'), 'Unexpected external dependency');
    const resolved = path.resolve(path.dirname(file), name);
    return load(path.extname(resolved) ? resolved : resolved + '.ts', mocks, deno);
  };
  new Function('exports', 'module', 'require', 'Deno', 'fetch', outputText)(
    module.exports, module, requireLocal, deno, () => { throw new Error('Network access is forbidden in config tests'); },
  );
  return module.exports;
}
const { resolveTicketEmbedRuntime } = load(path.join(__dirname, 'ticket-embed-runtime.ts'));
const resolve = (values) => resolveTicketEmbedRuntime((name) => values[name]);
function entry(name, values) {
  let dependencies, databaseCalls = 0, registrations = 0;
  const capture = (deps) => { dependencies = deps; return () => new Response(null); };
  const deno = { env: { get: (key) => values[key] }, serve: () => { registrations++; } };
  load(path.join(__dirname, '..', name, 'index.ts'), {
    'https://esm.sh/@supabase/supabase-js@2': { createClient: () => { databaseCalls++; return {}; } },
    '../_shared/ticket-embed-settings.ts': { createEmbedSettingsHandler: capture },
    '../_shared/ticket-embed-commerce.ts': { createTicketEmbedHandler: capture },
    '../_shared/verify-session.ts': { verifySession: async () => 'owner-fixture', corsHeaders: () => ({}) },
  }, deno);
  assert.equal(registrations, 1);
  return { dependencies, databaseCalls };
}

test('absent settings fail closed without throwing or defaulting to production', () => {
  const result = resolve({});
  assert.equal(result.paymentsEnabled, false);
  assert.equal(result.siteOrigin, '');
  assert.equal(result.problems.length, 3);
});
for (const mode of ['test', 'live']) {
  test(`matching ${mode} keys and explicit origin pass syntax gates`, () => {
    const result = resolve(valid(mode));
    assert.equal(result.paymentsEnabled, true);
    assert.equal(result.livemode, mode === 'live');
    assert.deepEqual(result.problems, []);
  });
  test(`matching ${mode} restricted key is supported`, () => {
    assert.equal(resolve({ ...valid(mode), STRIPE_SECRET_KEY: key('rk', mode) }).paymentsEnabled, true);
  });
  test(`mixed ${mode} secret / other-mode publishable key is blocked`, () => {
    const result = resolve({ ...valid(mode), STRIPE_PUBLISHABLE_KEY: key('pk', mode === 'test' ? 'live' : 'test') });
    assert.equal(result.paymentsEnabled, false);
    assert.ok(result.problems.includes('Stripe key modes do not match.'));
  });
}
for (const flag of [undefined, 'false', 'TRUE', '1', ' true ']) {
  test(`release flag must be explicitly true: ${String(flag)}`, () => {
    assert.equal(resolve({ ...valid(), TICKET_EMBED_PAYMENTS_ENABLED: flag }).paymentsEnabled, false);
  });
}
for (const [name, value] of [
  ['STRIPE_SECRET_KEY', 'sk_test_YOUR_SECRET_KEY'],
  ['STRIPE_PUBLISHABLE_KEY', 'pk_test_YOUR_PUBLISHABLE_KEY'],
  ['STRIPE_SECRET_KEY', 'sk_live_...'],
  ['STRIPE_PUBLISHABLE_KEY', 'pk_test_'],
  ['STRIPE_SECRET_KEY', ''],
  ['STRIPE_PUBLISHABLE_KEY', ''],
  ['STRIPE_SECRET_KEY', ' ' + key('sk', 'test')],
]) {
  test(`invalid or placeholder ${name}: case ${value.length}`, () => {
    assert.equal(resolve({ ...valid(), [name]: value }).paymentsEnabled, false);
  });
}
for (const url of [undefined, 'not-a-url', 'http://staging.example.com', 'https://user:pass@staging.example.com',
  'https://staging.example.com/path', 'https://staging.example.com/?x=1', 'https://staging.example.com/#x',
  'https://staging.example.com:8443', 'https://localhost', 'https://127.0.0.1', 'https://staging.internal',
  'https://staging.example.com\\@evil.example.com']) {
  test(`unsafe PUBLIC_SITE_URL fails closed: ${String(url)}`, () => {
    const result = resolve({ ...valid(), PUBLIC_SITE_URL: url });
    assert.equal(result.paymentsEnabled, false);
    assert.equal(result.siteOrigin, '');
  });
}
test('a root trailing slash normalizes without losing the staging origin', () => {
  const result = resolve({ ...valid(), PUBLIC_SITE_URL: 'https://staging.example.com/' });
  assert.equal(result.siteOrigin, 'https://staging.example.com');
  assert.equal(result.paymentsEnabled, true);
});
for (const host of ['dvntapp.live', 'www.dvntapp.live', 'dvnt.live', 'www.dvnt.live', 'dvntlive.app', 'www.dvntlive.app', 'dvnt-blog.vercel.app']) {
  test(`test credentials cannot target known production site ${host}`, () => {
    assert.equal(resolve({ ...valid(), PUBLIC_SITE_URL: `https://${host}` }).paymentsEnabled, false);
  });
}
test('configuration diagnostics do not expose either key value', () => {
  const values = { ...valid(), PUBLIC_SITE_URL: 'broken', STRIPE_PUBLISHABLE_KEY: key('pk', 'live') };
  const text = JSON.stringify(resolve(values).problems);
  assert.equal(text.includes(values.STRIPE_SECRET_KEY), false);
  assert.equal(text.includes(values.STRIPE_PUBLISHABLE_KEY), false);
});
for (const [label, values] of [
  ['ready staging', valid()], ['ready production', valid('live')], ['empty settings', {}],
  ['mixed keys', { ...valid(), STRIPE_PUBLISHABLE_KEY: key('pk', 'live') }],
  ['placeholder key', { ...valid(), STRIPE_SECRET_KEY: 'sk_test_YOUR_SECRET_KEY' }],
  ['missing site', { ...valid(), PUBLIC_SITE_URL: undefined }],
  ['malformed site', { ...valid(), PUBLIC_SITE_URL: 'malformed' }],
  ['payments off', { ...valid(), TICKET_EMBED_PAYMENTS_ENABLED: 'false' }],
]) {
  test(`actual entrypoints agree on publication/payment configuration: ${label}`, () => {
    const manager = entry('manage-ticket-embed', values);
    const commerce = entry('ticket-embed', values);
    const expected = resolve(values);
    assert.equal(manager.dependencies.paymentsEnabled, expected.paymentsEnabled);
    assert.equal(commerce.dependencies.enabled, expected.paymentsEnabled);
    assert.equal(manager.dependencies.siteOrigin, commerce.dependencies.siteOrigin);
    assert.equal(commerce.databaseCalls, expected.paymentsEnabled ? 1 : 0);
    // Incomplete payment setup does not hide the ability to manage draft settings.
    assert.equal(manager.dependencies.enabled, true);
  });
}
test('disabled builder with malformed payment settings creates no database client', () => {
  const result = entry('manage-ticket-embed', { TICKET_EMBED_BUILDER_ENABLED: 'false', PUBLIC_SITE_URL: 'malformed' });
  assert.equal(result.dependencies.enabled, false);
  assert.equal(result.databaseCalls, 0);
});
