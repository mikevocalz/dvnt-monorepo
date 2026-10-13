// Real handlers with synthetic Stripe, database and session boundaries only.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { harness } = require('./connect-onboarding-fixture.cjs');
for (const slug of ['organizer-connect', 'promoter-connect']) {
  test(`${slug}: browser can read authenticated onboarding and status responses`, async () => {
    const h = harness(slug);
    for (const action of ['start', 'status', ...(slug === 'organizer-connect' ? ['update'] : [])]) {
      const r = await h.call(action);
      assert.equal(r.headers.get('access-control-allow-origin'), 'https://dvntapp.live');
      assert.equal(r.headers.get('cache-control'), 'no-store');
      assert.equal(r.status, 200);
    }
    assert.equal(h.calls.some(c => c.endpoint === '/v1/accounts'), false, 'reuse existing account');
  });
  test(`${slug}: browser can read auth and Stripe errors without a misleading CORS failure`, async () => {
    const unauth = harness(slug, { user: null });
    const r = await unauth.call();
    assert.equal(r.status, 401);
    assert.equal(r.headers.get('access-control-allow-origin'), 'https://dvntapp.live');
    assert.equal(unauth.calls.length, 0);
    const error = await harness(slug, { stripeFailure: true }).call();
    assert.equal(error.headers.get('access-control-allow-origin'), 'https://dvntapp.live');
    assert.match(error.body.error, /unavailable/);
  });
  test(`${slug}: web return/refresh go to HTTPS, native retains its app scheme`, async () => {
    const h = harness(slug);
    await h.call();
    const link = h.calls.find(c => c.endpoint === '/v1/account_links');
    for (const kind of ['return', 'refresh']) {
      const callbackUrl = new URL(link.body.get(`${kind}_url`));
      assert.equal(callbackUrl.searchParams.get('platform'), 'web');
      const response = await h.callback(callbackUrl.search.slice(1));
      assert.equal(response.status, 302);
      const destination = new URL(response.headers.get('location'));
      assert.equal(destination.origin, 'https://dvntapp.live');
      assert.equal(destination.pathname, slug === 'promoter-connect' ? '/feed/events/42/promoter' : '/feed/events/organizer-setup');
      assert.equal(destination.searchParams.get('stripe_connect'), kind);
      const native = await h.callback(`callback=${kind}&platform=native&event_id=42&redirect=https://evil.example`);
      assert.equal(native.headers.get('location'), `dvnt://stripe/connect/${kind === 'return' ? 'success' : 'refresh'}`);
    }
  });
}
test('promoter ownership is checked before Stripe calls', async () => {
  const h = harness('promoter-connect', { owner: 'somebody-else' });
  assert.equal((await h.call()).status, 403);
  assert.equal(h.calls.length, 0);
});

test('Connect responses retain the existing trusted browser origin policy', async () => {
  for (const slug of ['organizer-connect', 'promoter-connect']) {
    const h = harness(slug, { user: null });
    for (const origin of ['https://dvntapp.live', 'https://www.dvntapp.live', 'https://hostile.example']) {
      const preflight = await h.handler(new Request('https://fixture.invalid', { method: 'OPTIONS', headers: { Origin: origin } }));
      assert.equal(preflight.status, 204);
      assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
      assert.match(preflight.headers.get('access-control-allow-headers'), /x-auth-token/);
      const r = await h.handler(new Request('https://fixture.invalid', { method: 'POST', headers: { Origin: origin }, body: '{}' }));
      assert.equal(r.headers.get('vary'), 'Origin');
      assert.equal(preflight.headers.get('access-control-allow-origin'), r.headers.get('access-control-allow-origin'));
      if (origin === 'https://hostile.example') {
        assert.notEqual(r.headers.get('access-control-allow-origin'), origin);
        assert.notEqual(r.headers.get('access-control-allow-origin'), '*');
      } else assert.equal(r.headers.get('access-control-allow-origin'), origin);
    }
  }
});
test('organizer API sends platform explicitly for both onboarding entry points', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../../../../../packages/app/lib/api/organizer.ts'), 'utf8');
  const code = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const sent = []; const exported = {};
  new Function('exports', 'require', code)(exported, name => {
    if (name.includes('supabase/client')) return { supabase: { functions: { invoke: async (_, options) => { sent.push(options.body); return { data: { url: 'https://connect.stripe.com/setup/fixture' } }; } } } };
    if (name.includes('auth/identity')) return { requireBetterAuthToken: async () => 'fixture' };
    return {};
  });
  await exported.organizerApi.startOnboarding('web');
  await exported.organizerApi.resumeVerification('web');
  await exported.organizerApi.startOnboarding();
  await exported.organizerApi.resumeVerification();
  assert.deepEqual(sent, [{ action: 'start', platform: 'web' }, { action: 'update', platform: 'web' }, { action: 'start', platform: 'native' }, { action: 'update', platform: 'native' }]);
});

test('organizer verification update uses web callbacks, not just initial start', async () => {
  const h = harness('organizer-connect');
  await h.call('update', 'web');
  const link = h.calls.find(c => c.endpoint === '/v1/account_links');
  assert.equal(new URL(link.body.get('return_url')).searchParams.get('platform'), 'web');
  assert.equal(new URL(link.body.get('refresh_url')).searchParams.get('platform'), 'web');
});
