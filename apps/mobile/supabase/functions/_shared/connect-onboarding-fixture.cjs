const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function harness(slug, { user = 'user-fixture', stripeFailure = false, owner = 'user-fixture' } = {}) {
  let handler;
  const calls = [];
  const rows = {
    organizer_accounts: [{ host_id: 'user-fixture', stripe_account_id: 'acct_fixture' }],
    event_promoters: [{ id: 'promoter-fixture', user_id: owner, event_id: 42, status: 'active', stripe_account_id: 'acct_fixture' }],
  };
  const db = { from(table) {
    const filters = []; let patch;
    const run = () => {
      const matches = (rows[table] || []).filter(r => filters.every(f => f(r)));
      if (patch) matches.forEach(r => Object.assign(r, patch));
      return { data: matches[0] || null, error: null };
    };
    const q = {
      select() { return q; }, eq(k, v) { filters.push(r => r[k] === v); return q; },
      neq(k, v) { filters.push(r => r[k] !== v); return q; }, update(p) { patch = p; return q; },
      maybeSingle: async () => run(), then: (ok, fail) => Promise.resolve(run()).then(ok, fail),
    }; return q;
  } };
  async function fetchFixture(url, options = {}) {
    const endpoint = new URL(url).pathname;
    const body = new URLSearchParams(options.body || '');
    calls.push({ endpoint, method: options.method || 'GET', body });
    if (stripeFailure) throw Error('Fixture Stripe unavailable');
    const data = endpoint === '/v1/account_links'
      ? { url: 'https://connect.stripe.com/setup/fixture' }
      : { id: 'acct_fixture', capabilities: { card_payments: 'inactive', transfers: 'inactive' }, details_submitted: false, payouts_enabled: false, charges_enabled: false, requirements: { currently_due: ['external_account'], pending_verification: [], disabled_reason: 'requirements.past_due' } };
    return { ok: true, json: async () => data };
  }
  const source = fs.readFileSync(path.join(__dirname, '..', slug, 'index.ts'), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const authCode = ts.transpileModule(fs.readFileSync(path.join(__dirname, 'verify-session.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const realAuth = {};
  new Function('exports', authCode)(realAuth);
  const requireFixture = name => {
    if (name.startsWith('https://esm.sh/')) return { createClient: () => db };
    if (name.endsWith('/verify-session.ts')) return {
      verifySession: async () => user,
      corsHeaders: realAuth.corsHeaders,
    };
    if (name.endsWith('/sentry.ts')) return { withSentry: (_, fn) => fn };
    throw Error(`Unexpected import ${name}`);
  };
  const deno = { env: { get: key => ({ STRIPE_SECRET_KEY: 'fixture', SUPABASE_URL: 'https://fixture.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture' })[key] }, serve: fn => { handler = fn; } };
  new Function('exports', 'require', 'Deno', 'fetch', code)({}, requireFixture, deno, fetchFixture);
  const call = async (action = 'start', platform = 'web') => {
    const response = await handler(new Request(`https://fixture.supabase.co/functions/v1/${slug}`, { method: 'POST', headers: { Origin: 'https://dvntapp.live' }, body: JSON.stringify({ action, event_id: 42, promoter_id: 'promoter-fixture', platform }) }));
    return { status: response.status, headers: response.headers, body: await response.json() };
  };
  const callback = query => handler(new Request(`https://fixture.supabase.co/functions/v1/${slug}?${query}`));
  return { call, callback, calls, handler };
}
module.exports = { harness };
