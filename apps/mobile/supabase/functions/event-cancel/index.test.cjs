const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function harness(actor, membership, status = 'published') {
  let handler;
  const calls = [], refunds = [];
  const db = { from(table) {
    const call = { table, filters: [] }; calls.push(call);
    const q = {
      select() { return q; }, order() { return q; }, maybeSingle() { return q; },
      update(value) { call.update = value; return q; },
      insert(value) { call.insert = value; return q; },
      then(resolve) {
        let data = [];
        if (table === 'events' && !call.update) data = { id: 42, host_id: 'owner', status, title: 'Fixture' };
        if (table === 'event_co_organizers') data = membership && call.filters.every(([key, value]) =>
          Array.isArray(value) ? value.includes(membership[key]) : membership[key] === value) ? membership : null;
        if (table === 'orders') data = [{ id: 'order-fixture', status: 'paid', stripe_payment_intent_id: 'pi_fixture', total_cents: 1000 }];
        return Promise.resolve({ data, error: null }).then(resolve);
      },
    };
    for (const op of ['eq', 'neq', 'in', 'is', 'ilike']) q[op] = (key, value) => { call.filters.push([key, value]); return q; };
    return q;
  }};
  const source = ts.transpileModule(fs.readFileSync(`${__dirname}/index.ts`, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(source, {
    exports: {}, console: { error() {}, warn() {} }, Response, URLSearchParams,
    fetch: async (url, options) => { refunds.push({ url, options }); return new Response(JSON.stringify({ id: 're_fixture' })); },
    Deno: { env: { get: () => 'fixture' }, serve: fn => { handler = fn; } },
    require: name => name.includes('supabase-js') ? { createClient: () => db }
      : name.includes('rate-limit') ? { checkRateLimit: () => ({ allowed: true }) }
      : name.includes('send-resend') ? { broadcast: () => ({}), sendResendEmail: async () => {} }
      : { verifySession: async () => actor, corsHeaders: () => ({}), optionsResponse: () => new Response(null, { status: 204 }) },
  });
  return { calls, refunds, run: () => handler(new Request('https://fixture.invalid', {
    method: 'POST', body: JSON.stringify({ eventId: 42 }),
  })) };
}

for (const status of ['published', 'cancelled']) test(`owner can ${status === 'cancelled' ? 'resume refunds' : 'cancel and refund'}`, async () => {
  const h = harness('owner', null, status);
  const response = await h.run(); const body = await response.json();
  assert.equal(response.status, 200); assert.equal(body.ok, true); assert.equal(body.refundsIssued, 1);
  assert.equal(body.resumed, status === 'cancelled');
  assert.equal(h.calls.some(c => c.table === 'events' && c.update), status !== 'cancelled');
  assert.equal(h.refunds.length, 1);
  assert.equal(h.refunds[0].options.headers['Idempotency-Key'], 'event-cancel-42-order-fixture');
});

for (const [label, membership] of [
  ...['admin', 'editor', 'scanner'].map(role => [role, { event_id: 42, user_id: 'staff', accepted: true, role }]),
  ['pending admin', { event_id: 42, user_id: 'staff', accepted: false, role: 'admin' }],
  ['removed or unrelated', null],
]) for (const status of ['published', 'cancelled']) test(`${label} cannot cancel or resume ${status} event`, async () => {
  const h = harness('staff', membership, status); const response = await h.run();
  assert.equal(response.status, 403);
  assert.equal(h.refunds.length, 0);
  assert.equal(h.calls.some(c => c.update || c.insert), false);
  assert.equal(h.calls.some(c => ['orders', 'tickets', 'event_waitlist'].includes(c.table)), false);
});

test('anonymous caller cannot read or cancel events', async () => {
  const h = harness(null, null); assert.equal((await h.run()).status, 401);
  assert.equal(h.calls.length, 0); assert.equal(h.refunds.length, 0);
});
