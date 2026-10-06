const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

// Same loader shape as create-event/index.test.cjs. Each table read resolves to
// a scripted result; an "older tickets" read is the tickets query that uses lt().
function loadShared(file) {
  const source = ts.transpileModule(
    fs.readFileSync(`${__dirname}/../_shared/${file}`, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const mod = { exports: {} };
  new Function('exports', 'module', source)(mod.exports, mod);
  return mod.exports;
}

function harness(script) {
  let handler;
  const inserts = [];
  const updates = [];
  const client = {
    from: (table) => {
      const calls = [];
      let payload;
      const resolve = () => {
        if (payload) {
          inserts.push({ table, payload });
          return { data: { id: 'offer-1', state: 'offered', ...payload } };
        }
        const key = table === 'tickets' && calls.includes('lt') ? 'olderTickets' : table;
        return script[key] ?? { data: null };
      };
      const query = {};
      for (const m of ['select', 'eq', 'in', 'lt', 'order', 'limit', 'update']) {
        query[m] = () => { calls.push(m); return query; };
      }
      query.insert = (value) => { payload = value; return query; };
      query.update = (value) => { updates.push({ table, value }); calls.push('update'); return query; };
      query.maybeSingle = async () => resolve();
      query.single = async () => resolve();
      query.then = (ok, fail) => Promise.resolve(resolve()).then(ok, fail);
      return query;
    },
  };
  const source = ts.transpileModule(
    fs.readFileSync(`${__dirname}/index.ts`, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
  vm.runInNewContext(source, {
    exports: {}, console: { log() {}, error() {} }, Response,
    Deno: { env: { get: () => 'test' }, serve: (fn) => { handler = fn; } },
    require: (name) => name.includes('supabase-js') ? { createClient: () => client }
      : name.includes('verify-session') ? {
        verifySession: async () => 'auth-1',
        jsonResponse: (body) => json(body),
        errorResponse: (message, status) => json({ ok: false, error: { message } }, status),
        optionsResponse: () => new Response(null, { status: 204 }),
      }
      : name.includes('verification-state') ? {
        resolveAdultVerificationState: async () => ({ state: script.verification ?? 'approved' }),
      }
      : name.includes('first-post-gate') ? loadShared('first-post-gate.ts')
      : { resolveOrProvisionUser: async () => ({ id: 7, auth_id: 'auth-1' }) },
  });
  const call = async (body) => {
    const res = await handler(new Request('http://test', { method: 'POST', body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  return { call, inserts, updates };
}

const CART = '11111111-1111-4111-8111-111111111111';
const happy = {
  first_post_offers: { data: null },
  carts: { data: { id: CART, user_id: 'auth-1', status: 'completed' } },
  posts: { data: null },
  tickets: { data: [{ id: 't-2', event_id: 5, category: 'admission', status: 'active', created_at: '2026-10-01T00:00:00Z', cart_id: CART }] },
  olderTickets: { data: [] },
  events: { data: { id: 5, title: 'Cookout', visibility: 'public', status: 'active', cities: { name: 'DC' } } },
};

test('a first admission ticket on a public event gets an offer', async () => {
  const h = harness(happy);
  const got = await h.call({ action: 'resolve', cartId: CART });
  assert.equal(got.body.reason, 'offered');
  assert.equal(h.inserts.length, 1);
});

test('a failed prior-ticket read does not create the once-per-member offer', async () => {
  const h = harness({ ...happy, olderTickets: { data: null, error: { message: 'timeout' } } });
  const got = await h.call({ action: 'resolve', cartId: CART });
  assert.equal(got.status, 500);
  assert.equal(h.inserts.length, 0);
});

test('a failed prior-post read does not create an offer', async () => {
  const h = harness({ ...happy, posts: { data: null, error: { message: 'timeout' } } });
  const got = await h.call({ action: 'resolve', cartId: CART });
  assert.equal(got.status, 500);
  assert.equal(h.inserts.length, 0);
});

test('a cart owned by someone else gets no offer', async () => {
  const h = harness({ ...happy, carts: { data: { id: CART, user_id: 'auth-2', status: 'completed' } } });
  const got = await h.call({ action: 'resolve', cartId: CART });
  assert.equal(got.body.reason, 'cart_not_completed');
  assert.equal(h.inserts.length, 0);
});

// R04: the checklist publishes the ticket post only after adult verification,
// so the offer is refused for anyone not approved, even with enforce = false.
for (const state of ['not_started', 'pending', 'retry_required', 'rejected']) {
  test(`a member whose verification is ${state} is not offered the first post`, async () => {
    const h = harness({ ...happy, verification: state });
    const got = await h.call({ action: 'resolve', cartId: CART });
    assert.equal(got.body.offer, null);
    assert.equal(got.body.reason, 'adult_verification_required');
    assert.equal(h.inserts.length, 0);
  });
}

test('an unverified member cannot accept an outstanding offer', async () => {
  const h = harness({
    ...happy,
    verification: 'pending',
    first_post_offers: { data: { id: 'offer-1', user_id: 'auth-1', event_id: 5, state: 'offered' } },
  });
  const got = await h.call({ action: 'accept' });
  assert.equal(got.body.offer, null);
  assert.equal(got.body.reason, 'adult_verification_required');
  assert.equal(h.updates.length, 0);
});

test('a verified member can accept an outstanding offer', async () => {
  const h = harness({
    ...happy,
    first_post_offers: { data: { id: 'offer-1', user_id: 'auth-1', event_id: 5, state: 'offered' } },
  });
  await h.call({ action: 'accept' });
  assert.equal(h.updates.length, 1);
});

test('a private event never produces a ticket post offer', async () => {
  for (const visibility of ['private', 'link_only', 'unlisted', null]) {
    const h = harness({ ...happy, events: { data: { ...happy.events.data, visibility } } });
    const got = await h.call({ action: 'resolve', cartId: CART });
    assert.equal(got.body.offer, null);
    assert.equal(got.body.reason, 'event_not_public');
    assert.equal(h.inserts.length, 0);
  }
});
