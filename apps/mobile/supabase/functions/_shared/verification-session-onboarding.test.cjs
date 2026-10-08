const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Exercise the real Edge Function with only external services mocked.
// Protects the production incident's exact condition: absent Didit secrets
// must never return a successful HTTP 200 with an opaque error body.
const source = fs.readFileSync(path.join(__dirname, '../create-verification-session/index.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function harness({ key, workflow, existing = null, providerResponse, statusError = null }) {
  const calls = [];
  const writes = [];
  const db = {
    from(table) {
      assert.equal(table, 'identity_verifications');
      return {
        select() {
          return { eq() { return { maybeSingle: async () => ({ data: existing, error: statusError }) }; } };
        },
        upsert: async row => { writes.push(row); return { error: null }; },
      };
    },
  };
  let handler;
  const env = {
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
    DIDIT_API_KEY: key,
    DIDIT_WORKFLOW_ID: workflow,
  };
  const mods = {
    'https://esm.sh/@supabase/supabase-js@2': { createClient: () => db },
    '../_shared/verify-session.ts': {
      verifySession: async () => 'signed-in-user',
      corsHeaders: () => ({ 'Access-Control-Allow-Origin': '*' }),
      optionsResponse: () => new Response(null, { status: 204 }),
    },
    '../_shared/sentry.ts': { withSentry: (_, fn) => fn },
    '../_shared/age-policy.ts': { checkAdultBirthDate: () => ({ allowed: true }) },
    '../_shared/verification-state.ts': {
      normalizeVerificationState: () => ({ state: 'not_started', retryable: true }),
    },
  };
  vm.runInNewContext(compiled, {
    exports: {},
    require: id => {
      if (!(id in mods)) throw new Error('unexpected import ' + id);
      return mods[id];
    },
    Deno: { env: { get: name => env[name] }, serve: fn => { handler = fn; } },
    Request, Response, URL, AbortSignal,
    console: { error: () => {} },
    fetch: async (url, opts) => {
      calls.push({ url, opts });
      return new Response(JSON.stringify(providerResponse || {
        session_id: 'ses_123', url: 'https://verify.didit.me/?session_token=test-token',
      }), { status: 201, headers: { 'Content-Type': 'application/json' } });
    },
  });
  return {
    calls, writes,
    request: (returnUrl = 'https://dvntapp.live/auth/signup') =>
      handler(new Request('https://example.supabase.co/functions/v1/create-verification-session', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ returnUrl }),
      })),
  };
}

test('missing Didit secret is a retryable 503, not HTTP 200 success', async () => {
  const h = harness({ key: undefined, workflow: 'wf_123' });
  const response = await h.request();
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error.code, 'not_configured');
  assert.equal(h.calls.length, 0);
  assert.equal(h.writes.length, 0);
});

test('an already-verified adult can continue even if Didit is misconfigured', async () => {
  const h = harness({ existing: { status: 'passed', date_of_birth: '1990-01-01' } });
  const response = await h.request();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.status, 'passed');
  assert.equal(h.calls.length, 0);
});

test('Didit v3 session is correlated before the URL is given to the user', async () => {
  const h = harness({ key: 'test-key', workflow: 'wf_123' });
  const response = await h.request();
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.status, 'pending');
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].url, 'https://verification.didit.me/v3/session/');
  const body = JSON.parse(h.calls[0].opts.body);
  assert.equal(body.vendor_data, 'signed-in-user');
  assert.equal(body.workflow_id, 'wf_123');
  assert.equal(body.callback, 'https://dvntapp.live/auth/signup');
  assert.equal(h.writes.length, 1);
  assert.equal(h.writes[0].user_id, 'signed-in-user');
  assert.equal(h.writes[0].provider_ref, 'ses_123');
});

test('callbacks outside DVNT origins are not sent to Didit', async () => {
  const h = harness({ key: 'test-key', workflow: 'wf_123' });
  await h.request('https://attacker.example/collect');
  assert.equal('callback' in JSON.parse(h.calls[0].opts.body), false);
});

test('untrusted provider URLs are never returned to clients', async () => {
  const h = harness({ key: 'test-key', workflow: 'wf_123',
    providerResponse: { session_id: 'ses_123', url: 'https://attacker.example/collect' } });
  const response = await h.request();
  assert.equal(response.status, 502);
  assert.equal((await response.json()).error.code, 'provider_bad_response');
  assert.equal(h.writes.length, 0);
});
