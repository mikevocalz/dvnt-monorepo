// Checklist section 1 acceptance, run against the edge functions themselves.
//
// Four personas, with verified_admission_policy enforced (enforce = true, no
// cohort, no grace). The gate modules are the real ones (verified-admission,
// verification-state, age-policy, spicy-access); only the session lookup,
// the database and third-party SDKs are stand-ins.
//
//   buyer   new account, never verified, holds a ticket
//   minor   ID check returned a 2009 date of birth, holds a ticket
//   legacy  account from 2023, never verified, holds a ticket
//   adult   passed ID check with a 1990 date of birth
//
// Expected: everyone can check out. Only the adult can post, comment, post a
// story, host an event, join a Lynk room or receive SPICY posts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { harness: paymentHarness } = require('./payment-safety.test.cjs');

const FUNCTIONS = path.resolve(__dirname, '..');
const NOW_YEAR = new Date().getUTCFullYear();

const PERSONAS = {
  buyer: { authId: 'auth_buyer', userId: 1, createdAt: `${NOW_YEAR}-01-02T00:00:00Z`, record: null },
  minor: { authId: 'auth_minor', userId: 2, createdAt: `${NOW_YEAR}-01-02T00:00:00Z`,
    // Turns 18 next year, whatever year the suite runs in.
    record: { status: 'failed', date_of_birth: `${NOW_YEAR - 17}-06-01`, failure_code: 'underage' } },
  legacy: { authId: 'auth_legacy', userId: 3, createdAt: '2023-03-01T00:00:00Z', record: null },
  adult: { authId: 'auth_adult', userId: 4, createdAt: `${NOW_YEAR}-01-02T00:00:00Z`,
    record: { status: 'passed', date_of_birth: '1990-05-04' } },
};
const SPICY_AUTHOR = 9;
const ENFORCED = { id: 1, enforce: true, cohort_created_after: null, grace_deadline: null, allowlist: [], denylist: [] };

function seed(policy = ENFORCED) {
  const users = Object.values(PERSONAS).map(p => ({ id: p.userId, auth_id: p.authId, username: p.authId }));
  users.push({ id: SPICY_AUTHOR, auth_id: 'auth_author', username: 'author' });
  return {
    verified_admission_policy: [policy],
    user: Object.values(PERSONAS).map(p => ({ id: p.authId, createdAt: p.createdAt })),
    identity_verifications: Object.values(PERSONAS).filter(p => p.record)
      .map(p => ({ user_id: p.authId, failure_code: null, failure_message: null, provider_ref: null, ...p.record })),
    users,
    // Holding a ticket must not change any verdict below.
    tickets: Object.values(PERSONAS).map((p, i) => ({ id: 100 + i, user_id: p.authId, event_id: 1, status: 'active' })),
    follows: Object.values(PERSONAS).map(p => ({ id: p.userId, follower_id: p.userId, following_id: SPICY_AUTHOR })),
    posts: [
      { id: 10, author_id: SPICY_AUTHOR, is_nsfw: true, visibility: 'public', post_kind: 'text', content: 'spicy', created_at: '2026-09-01T00:00:00Z' },
      { id: 11, author_id: SPICY_AUTHOR, is_nsfw: false, visibility: 'public', post_kind: 'text', content: 'safe', created_at: '2026-09-02T00:00:00Z' },
      { id: 12, author_id: PERSONAS.buyer.userId, is_nsfw: true, visibility: 'public', post_kind: 'text', content: 'own spicy', created_at: '2026-09-03T00:00:00Z' },
      { id: 13, author_id: PERSONAS.buyer.userId, is_nsfw: false, visibility: 'public', post_kind: 'text', content: 'own safe', created_at: '2026-09-04T00:00:00Z' },
      { id: 14, author_id: PERSONAS.adult.userId, is_nsfw: false, visibility: 'public', post_kind: 'text', content: 'adult safe', created_at: '2026-09-05T00:00:00Z' },
    ],
    post_text_slides: [10, 11, 12].map(postId => ({ id: postId * 10, post_id: postId, slide_index: 0, content: `slide ${postId}` })),
    bookmarks: Object.values(PERSONAS).map(p => ({ user_id: p.userId, post_id: 10, created_at: '2026-09-10T00:00:00Z' })),
    liked_activity_history: Object.values(PERSONAS).map(p => ({ id: p.userId, user_id: p.userId, entity_type: 'post', entity_id: 10, created_at: '2026-09-10T00:00:00Z' })),
    posts_media: [{ _parent_id: 10, type: 'image', url: 'https://cdn.test/spicy.jpg', _order: 0 }],
  };
}

/** In-memory PostgREST stand-in. Embedded selects are ignored; unknown tables are empty. */
function fakeDb(tables) {
  const writes = [];
  let nextId = 1000;
  const parseValue = v => (v === 'null' ? null : v === 'true' ? true : v === 'false' ? false : v);
  function from(table) {
    const filters = [];
    let op = 'select', payload, countMode = false, limit = Infinity;
    const rows = () => (tables[table] ||= []);
    const matches = row => filters.every(f => f(row));
    const run = () => {
      if (op === 'insert' || op === 'upsert') {
        const list = (Array.isArray(payload) ? payload : [payload]).map(r => ({ id: nextId++, ...r }));
        rows().push(...list); writes.push({ table, op, payload });
        return { data: Array.isArray(payload) ? list : list[0], error: null };
      }
      if (op === 'update') {
        const hit = rows().filter(matches); hit.forEach(r => Object.assign(r, payload));
        writes.push({ table, op, payload }); return { data: hit, error: null };
      }
      if (op === 'delete') {
        tables[table] = rows().filter(r => !matches(r)); writes.push({ table, op });
        return { data: null, error: null };
      }
      const hit = rows().filter(matches);
      return { data: hit.slice(0, limit), error: null, count: countMode ? hit.length : null };
    };
    const builder = new Proxy({}, {
      get(_t, name) {
        switch (name) {
          case 'select': return (_cols, opts) => { if (opts?.count) countMode = true; return builder; };
          case 'insert': case 'upsert': return p => { op = name; payload = p; return builder; };
          case 'update': return p => { op = 'update'; payload = p; return builder; };
          case 'delete': return () => { op = 'delete'; return builder; };
          case 'eq': return (k, v) => { filters.push(r => String(r[k]) === String(v)); return builder; };
          case 'neq': return (k, v) => { filters.push(r => String(r[k]) !== String(v)); return builder; };
          case 'in': return (k, vs) => { filters.push(r => vs.map(String).includes(String(r[k]))); return builder; };
          case 'is': return (k, v) => { filters.push(r => (r[k] ?? null) === v); return builder; };
          case 'not': return (k, o, v) => {
            if (o === 'in') { const vs = String(v).replace(/[()]/g, '').split(','); filters.push(r => !vs.includes(String(r[k]))); }
            return builder; };
          case 'or': return expr => {
            const parts = String(expr).split(',').map(s => s.split('.'));
            filters.push(r => parts.some(([k, o, v]) => {
              const want = parseValue(v);
              return o === 'is' ? (r[k] ?? null) === want : o === 'eq' ? String(r[k]) === String(v) : true;
            }));
            return builder; };
          case 'limit': return n => { limit = n; return builder; };
          case 'range': return (a, b) => { limit = b - a + 1; return builder; };
          case 'single': return async () => { const r = run(); const d = Array.isArray(r.data) ? r.data[0] : r.data;
            return d ? { data: d, error: null } : { data: null, error: { code: 'PGRST116', message: 'no rows' } }; };
          case 'maybeSingle': return async () => { const r = run(); const d = Array.isArray(r.data) ? r.data[0] : r.data;
            return { data: d ?? null, error: null }; };
          case 'then': return (res, rej) => Promise.resolve(run()).then(res, rej);
          default: return () => builder; // order, gte, lte, ilike, returns, abortSignal, ...
        }
      },
    });
    return builder;
  }
  return { db: { from, rpc: async () => ({ data: null, error: null }), storage: { from: () => ({}) } }, writes, tables };
}

function harness({ policy = ENFORCED, stubs = {} } = {}) {
  const fake = fakeDb(seed(policy));
  let handler;
  const actorOf = req => req.headers.get('x-test-actor');
  const baseStubs = {
    'verify-session.ts': {
      verifySessionDetailed: async (_db, req) => actorOf(req) ? { ok: true, userId: actorOf(req) } : { ok: false, reason: 'missing' },
      verifySession: async (_db, req) => actorOf(req) || null,
      corsHeaders: () => ({}), CORS_HEADERS: {}, optionsResponse: () => new Response(null, { status: 204 }),
      jsonResponse: (data, status = 200) => Response.json(data, { status }),
      errorResponse: (error, status = 400) => Response.json({ error }, { status }),
    },
    'resolve-user.ts': { resolveOrProvisionUser: async (_db, authId) => fake.tables.users.find(u => u.auth_id === authId) || null },
    'rate-limit.ts': { checkRateLimit: () => ({ allowed: true }), WRITE_LIMIT: {} },
    'sentry.ts': { withSentry: (_name, fn) => fn, captureEdge: async () => {} },
    'event-access.ts': { resolveEventRoomAccess: async () => ({ allowed: true }), canAccessEvent: async () => true },
    'call-media.ts': { provisionCallMedia: async () => ({}) },
    ...stubs,
  };
  function load(filename) {
    const exports = {};
    const source = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(source, {
      exports, Response, Request, URL, URLSearchParams, crypto, TextEncoder, TextDecoder, Date, Promise,
      setTimeout, clearTimeout, console: { log() {}, error() {}, warn() {}, info() {} },
      Deno: { env: { get: () => 'test' }, serve: fn => { handler = fn; } },
      fetch: async () => Response.json({}),
      require: name => {
        if (name.includes('supabase-js')) return { createClient: () => fake.db };
        if (name.includes('zod')) return require('zod');
        if (name.includes('fishjam')) return { FishjamClient: class { constructor() {} } };
        const stub = baseStubs[path.basename(name)];
        return stub || load(path.resolve(path.dirname(filename), name));
      },
    });
    return exports;
  }
  return {
    fake,
    async call(fn, actor, body) {
      load(path.join(FUNCTIONS, fn, 'index.ts'));
      const headers = { Authorization: 'Bearer test', 'content-type': 'application/json' };
      if (actor) headers['x-test-actor'] = actor;
      const res = await handler(new Request('http://test', { method: 'POST', headers, body: JSON.stringify(body) }));
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text }; }
      return { status: res.status, json };
    },
  };
}

const ADMISSION_REASONS = new Set(['verification_required', 'verification_incomplete', 'age_evidence_missing', 'underage', 'unauthenticated']);
/** True when the response is the verified-admission refusal, in any of the rails' shapes. */
function refusedForVerification({ json }) {
  const e = json?.error;
  if (!e || typeof e !== 'object') return false;
  if (e.code === 'verification_required') return true;
  return e.code === 'forbidden' && ADMISSION_REASONS.has(e.detail?.reason);
}

const BLOCKED = ['buyer', 'minor', 'legacy'];
const ALL = [...BLOCKED, 'adult'];

// ── Protected actions: blocked for the three, open for the verified adult ──
const PROTECTED = [
  ['create-post', { content: 'hello', kind: 'text' }],
  ['add-comment', { postId: 11, content: 'hi' }],
  ['create-story', { items: [] }],
  ['update-post', { postId: 13, content: 'edit' }],
  ['create-event', { title: 'Party', date: '2026-12-01T20:00:00Z', location: 'DC' }],
  ['video_join_room', { roomId: 1 }],
  ['lynk-moq-token', { roomId: 1 }],
];
for (const [fn, body] of PROTECTED) {
  for (const who of ALL) {
    test(`${fn}: ${who} is ${who === 'adult' ? 'admitted' : 'refused'} with the policy enforced`, async () => {
      const h = harness();
      const persona = PERSONAS[who];
      const res = await h.call(fn, persona.authId, { ...body, expectedAuthId: persona.authId });
      assert.equal(refusedForVerification(res), who !== 'adult', `${fn}/${who}: ${JSON.stringify(res.json)}`);
      if (who === 'minor') assert.equal(res.json.error.reason ?? res.json.error.detail?.reason ?? 'underage', 'underage');
    });
  }
}

test('the minor stays blocked even with enforcement off (A02)', async () => {
  const h = harness({ policy: { ...ENFORCED, enforce: false } });
  for (const [fn, body] of PROTECTED) {
    const res = await h.call(fn, PERSONAS.minor.authId, { ...body, expectedAuthId: PERSONAS.minor.authId });
    assert.equal(refusedForVerification(res), true, `${fn}: ${JSON.stringify(res.json)}`);
  }
});

// ── Ticket purchase never consults the gate (A01/A03) ─────────────────────
const refusingGate = { 'verified-admission.ts': {
  resolveVerifiedAdmission: async () => ({ state: 'blocked', reason: 'verification_required', deadline: null, message: 'Verify your ID' }),
  admissionRefusal: v => ({ code: 'verification_required', reason: v.reason, message: v.message }),
} };
test('ticket-checkout: a buyer the gate would refuse still checks out', async () => {
  const h = paymentHarness({ dependencyOverrides: refusingGate });
  const res = await h.invoke('ticket-checkout', { event_id: 1, ticket_type_id: 'tier', quantity: 1 });
  assert.equal(res.status, 200, await res.text());
  assert.ok(h.requests.some(r => r.url.includes('stripe')), 'reached Stripe');
});
test('cart-checkout: a buyer the gate would refuse still checks out', async () => {
  const h = paymentHarness({ cart: true, dependencyOverrides: refusingGate });
  const res = await h.invoke('cart-checkout', { cartId: '00000000-0000-4000-8000-000000000001' });
  assert.equal(res.status, 200, await res.text());
});
test('no ticket purchase, hold, RSVP or wallet rail imports the admission gate', () => {
  const rails = ['ticket-checkout', 'cart-checkout', 'guest-checkout', 'cart-create-hold', 'create-payment-intent',
    'rsvp-issue-ticket', 'rsvp-issue-guest', 'get-my-tickets', 'get-guest-ticket', 'transfer-ticket',
    'ticket_wallet_apple', 'ticket_wallet_google', 'sneaky-access-checkout'];
  for (const fn of rails) {
    const file = path.join(FUNCTIONS, fn, 'index.ts');
    if (!fs.existsSync(file)) continue;
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /from ["'][^"']*verified-admission/, fn);
  }
});

// ── SPICY reads ───────────────────────────────────────────────────────────
const spicyIds = posts => (posts || []).filter(p => p.isNSFW === true || p.is_nsfw === true).map(p => String(p.id));

for (const who of ALL) {
  test(`bootstrap-feed: ${who} ${who === 'adult' ? 'receives' : 'does not receive'} a followed author's SPICY post`, async () => {
    const res = await harness().call('bootstrap-feed', PERSONAS[who].authId, { include_nsfw: true });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(spicyIds(res.json.posts).includes('10'), who === 'adult', JSON.stringify(spicyIds(res.json.posts)));
  });
  test(`bootstrap-profile: ${who} ${who === 'adult' ? 'receives' : 'does not receive'} SPICY posts on a followed profile`, async () => {
    const res = await harness().call('bootstrap-profile', PERSONAS[who].authId, { user_id: SPICY_AUTHOR, include_nsfw: true });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(spicyIds(res.json.posts).includes('10'), who === 'adult', JSON.stringify(res.json.posts));
  });
  test(`get-text-post-slides: ${who} ${who === 'adult' ? 'gets' : 'does not get'} a SPICY post's slides`, async () => {
    const res = await harness().call('get-text-post-slides', PERSONAS[who].authId, { postIds: [10, 11] });
    const ids = res.json.data.posts.map(p => p.postId);
    assert.ok(ids.includes('11'));
    assert.equal(ids.includes('10'), who === 'adult', JSON.stringify(ids));
  });
  test(`get-bookmarks: ${who} ${who === 'adult' ? 'gets' : 'does not get'} a bookmarked SPICY post back`, async () => {
    const res = await harness().call('get-bookmarks', PERSONAS[who].authId, { withPosts: true });
    assert.equal(res.status, 200, JSON.stringify(res.json));
    assert.equal(res.json.posts.some(p => String(p.id) === '10'), who === 'adult', JSON.stringify(res.json));
  });
  test(`get-liked-activity: ${who} ${who === 'adult' ? 'sees' : 'does not see'} a liked SPICY post's text and image`, async () => {
    const res = await harness().call('get-liked-activity', PERSONAS[who].authId, {});
    assert.equal(res.status, 200, JSON.stringify(res.json));
    const item = res.json.items.find(i => i.entityId === '10');
    assert.ok(item, JSON.stringify(res.json));
    assert.equal(item.title === 'spicy', who === 'adult', item.title);
    assert.equal(item.previewImage === 'https://cdn.test/spicy.jpg', who === 'adult', item.previewImage);
  });
}

test('bootstrap-feed: an unverified author still sees their own SPICY post', async () => {
  const res = await harness().call('bootstrap-feed', PERSONAS.buyer.authId, { include_nsfw: true });
  assert.deepEqual(spicyIds(res.json.posts), ['12']);
});
test('bootstrap-profile: a signed-out viewer gets no SPICY posts', async () => {
  const res = await harness().call('bootstrap-profile', null, { user_id: SPICY_AUTHOR, include_nsfw: true });
  assert.equal(res.status, 200, JSON.stringify(res.json));
  assert.deepEqual(spicyIds(res.json.posts), []);
});
test('SPICY reads stay gated with enforcement off: the rule is the approved ID, not the rollout', async () => {
  const res = await harness({ policy: { ...ENFORCED, enforce: false } })
    .call('bootstrap-feed', PERSONAS.legacy.authId, { include_nsfw: true });
  assert.deepEqual(spicyIds(res.json.posts), []);
});
test('live-surface filters SPICY out of its public post query', () => {
  const src = fs.readFileSync(path.join(FUNCTIONS, 'live-surface', 'index.ts'), 'utf8');
  const query = src.slice(src.indexOf('async function buildTile2'), src.indexOf('const items: Tile2Item[]'));
  assert.match(query, /\.or\("is_nsfw\.is\.false,is_nsfw\.is\.null"\)/);
});

// ── update-post cannot flip a post to SPICY without an approved ID ────────
for (const enforce of [false, true]) {
  test(`update-post: an unverified owner cannot mark a post SPICY (enforce=${enforce})`, async () => {
    const h = harness({ policy: { ...ENFORCED, enforce } });
    const res = await h.call('update-post', PERSONAS.buyer.authId, { postId: 13, isNSFW: true });
    assert.equal(res.json.ok, false);
    assert.ok(['adult_verification_required', 'verification_required'].includes(res.json.error.code), JSON.stringify(res.json));
    assert.equal(h.fake.tables.posts.find(p => p.id === 13).is_nsfw, false);
  });
}
test('update-post: the verified adult can mark their own post SPICY', async () => {
  const h = harness();
  const res = await h.call('update-post', PERSONAS.adult.authId, { postId: 14, isNSFW: true });
  assert.equal(res.json.ok, true, JSON.stringify(res.json));
  assert.equal(h.fake.tables.posts.find(p => p.id === 14).is_nsfw, true);
});
