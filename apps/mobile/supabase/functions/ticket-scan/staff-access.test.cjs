const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Stateful offline endpoint fixture; real verify-session and limiter code.
// DB redemption is simulated, not proof of deployed SQL or real device camera behavior.
function fixture() {
  let handler, sequence = 0, sessionReads = 0;
  const rpcCalls = [];
  const tables = {
    events: [{ id: 7, host_id: 'host' }],
    session: [], tickets: [], users: [], order_addons: [], ticket_types: [], effective_membership_tiers: [],
    event_co_organizers: [
      ...['admin', 'editor', 'scanner'].map(role => ({ event_id: 7, user_id: role, role, accepted: true })),
      { event_id: 7, user_id: 'invited', role: 'scanner', accepted: false },
      { event_id: 8, user_id: 'other-event', role: 'scanner', accepted: true },
    ],
  };
  for (const user of ['host', 'admin', 'editor', 'scanner', 'attendee', 'invited', 'other-event']) {
    for (let device = 1; device <= 5; device++) tables.session.push({ token: `${user}-session-${device}`, userId: user, expiresAt: '2099-01-01' });
  }
  tables.session.push({ token: 'expired', userId: 'scanner', expiresAt: '2020-01-01' });
  const db = {
    from(table) {
      const predicates = [];
      const rows = () => (tables[table] || []).filter(r => predicates.every(p => p(r)));
      const q = {
        select: () => q, order: () => q, limit: () => q,
        eq: (k,v) => { predicates.push(r => r[k] === v); return q; },
        in: (k,vs) => { predicates.push(r => vs.includes(r[k])); return q; },
        single: async () => ({ data: rows()[0] ?? null, error: null }),
        maybeSingle: async () => { if (table === 'session') sessionReads++; return { data: rows()[0] ?? null, error: null }; },
        then: (resolve,reject) => Promise.resolve({ data: rows(), error: null }).then(resolve,reject),
      };
      return q;
    },
    async rpc(name,args) {
      rpcCalls.push({ name, args }); assert.equal(name, 'redeem_ticket');
      const t = tables.tickets.find(t => t.qr_token === args.p_qr_token);
      if (!t) return { data: { result: 'invalid' }, error: null };
      if (t.status === 'scanned') return { data: { result: 'already_scanned', ticketId: t.id, checkedInBy: t.checked_in_by }, error: null };
      t.status = 'scanned'; t.checked_in_by = args.p_scanned_by;
      return { data: { result: 'valid', ticketId: t.id, eventId: 7, ticketStatus: 'scanned' }, error: null };
    },
  };
  const cache = new Map();
  function load(filename) {
    if (cache.has(filename)) return cache.get(filename);
    const exports = {}; cache.set(filename, exports);
    const code = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    vm.runInNewContext(code, { exports, Request, Response, crypto, TextEncoder,
      console: { log() {}, error() {}, warn() {} },
      Deno: { env: { get: () => 'offline-test' }, serve: fn => { handler = fn; } },
      require: name => name.includes('supabase-js') ? { createClient: () => db }
        : name.endsWith('sentry.ts') ? { withSentry: (_name,fn) => fn }
        : load(path.resolve(path.dirname(filename), name)),
    });
    return exports;
  }
  load(path.resolve(__dirname, 'index.ts'));
  return {
    tables, rpcCalls, get sessionReads() { return sessionReads; },
    async scan(token, opts = {}) {
      const qrToken = opts.qrToken ?? `ticket-${++sequence}`;
      if (!tables.tickets.some(t => t.qr_token === qrToken)) tables.tickets.push({
        id: qrToken, qr_token: qrToken, event_id: 7, status: 'active', user_id: 'guest', category: 'admission',
      });
      const headers = { ...(opts.ip === null ? {} : { 'x-forwarded-for': opts.ip || '192.0.2.40' }),
        ...(token ? { [opts.legacy ? 'Authorization' : 'x-auth-token']: opts.legacy ? `Bearer ${token}` : token } : {}) };
      return handler(new Request('http://offline.test', { method: 'POST', headers,
        body: JSON.stringify({ qr_token: qrToken, event_id: 7, device_id: opts.deviceId }) }));
    },
  };
}

test('host and every accepted staff role independently redeem tickets on the same venue Wi-Fi', async () => {
  const f = fixture();
  const responses = await Promise.all(['host', 'admin', 'editor', 'scanner'].map(user => f.scan(`${user}-session-1`)));
  for (const r of responses) { assert.equal(r.status, 200); assert.equal((await r.json()).valid, true); }
  assert.deepEqual(new Set(f.rpcCalls.map(c => c.args.p_scanned_by)), new Set(['host', 'admin', 'editor', 'scanner']));
});

test('one busy staff session cannot consume another account or same account device session lane', async () => {
  const f = fixture();
  for (let i=0; i<30; i++) assert.equal((await f.scan('scanner-session-1')).status, 200);
  assert.equal((await f.scan('scanner-session-1')).status, 429);
  for (const token of ['admin-session-1', 'scanner-session-2']) {
    const r = await f.scan(token); assert.equal(r.status, 200); assert.equal((await r.json()).valid, true);
  }
});

test('missing forwarded IP does not collapse valid staff into the old 30/min anon bucket', async () => {
  const f = fixture();
  for (let i=0; i<30; i++) await f.scan('scanner-session-1', { ip: null });
  assert.equal((await f.scan('admin-session-1', { ip: null })).status, 200);
});

test('device_id spoofing cannot bypass a session cap; account cap bounds multiple valid sessions', async () => {
  const f = fixture();
  for (let device=1; device<=4; device++) {
    for (let i=0; i<30; i++) assert.equal((await f.scan(`scanner-session-${device}`, { deviceId: `spoof-${i}` })).status, 200);
    assert.equal((await f.scan(`scanner-session-${device}`, { deviceId: 'new-id' })).status, 429);
  }
  assert.equal((await f.scan('scanner-session-5')).status, 429);
  assert.equal((await f.scan('admin-session-1')).status, 200);
});

test('invalid/missing/expired sessions and nonstaff never reach redemption', async () => {
  const f = fixture();
  for (const token of [null, 'unknown-token', 'expired']) assert.equal((await f.scan(token)).status, 401);
  for (const user of ['attendee', 'invited', 'other-event']) assert.equal((await f.scan(`${user}-session-1`)).status, 403);
  assert.equal(f.rpcCalls.length, 0);
});

test('repeated invalid credential attempts are stopped before additional session lookups', async () => {
  const f = fixture();
  for (let i=0; i<30; i++) assert.equal((await f.scan('bad-session')).status, 401);
  assert.equal(f.sessionReads, 30);
  assert.equal((await f.scan('bad-session', { deviceId: 'changed' })).status, 429);
  assert.equal(f.sessionReads, 30); assert.equal(f.rpcCalls.length, 0);
});

test('coarse pre-auth IP ceiling bounds attacks rotating invalid credentials, even without gateway IP', async () => {
  for (const ip of ['192.0.2.99', null]) {
    const f = fixture();
    for (let i=0; i<600; i++) assert.equal((await f.scan(`bad-${i}`, { ip })).status, 401);
    assert.equal((await f.scan('another-bad', { ip })).status, 429);
    assert.equal(f.sessionReads, 600); assert.equal(f.rpcCalls.length, 0);
  }
});

test('legacy auth header uses the same credential lane and cannot double its quota', async () => {
  const f = fixture();
  for (let i=0; i<30; i++) assert.equal((await f.scan('scanner-session-1', { legacy: i % 2 === 0 })).status, 200);
  assert.equal((await f.scan('scanner-session-1', { legacy: true })).status, 429);
});

test('simultaneous staff scans retain one-time redemption and original scanner attribution', async () => {
  const f = fixture();
  const responses = await Promise.all(['admin', 'scanner'].map(user => f.scan(`${user}-session-1`, { qrToken: 'same-qr' })));
  const bodies = await Promise.all(responses.map(r => r.json()));
  assert.equal(bodies.filter(b => b.valid).length, 1);
  assert.equal(bodies.filter(b => b.reason === 'already_scanned').length, 1);
  assert.equal(f.rpcCalls.length, 2);
  assert.ok(['admin', 'scanner'].includes(f.tables.tickets[0].checked_in_by));
});

test('rotating both forwarded headers and invalid credentials remains bounded before auth', async () => {
  const f = fixture();
  for (let i=0; i<6000; i++) assert.equal((await f.scan(`invalid-${i}`, { ip: `spoofed-${i}` })).status, 401);
  assert.equal(f.sessionReads, 6000);
  assert.equal((await f.scan('fresh-invalid', { ip: 'fresh-forwarded' })).status, 429);
  assert.equal(f.sessionReads, 6000); assert.equal(f.rpcCalls.length, 0);
});
