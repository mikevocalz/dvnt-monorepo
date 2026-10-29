const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Same loader shape as event-lynk-invite/index.test.cjs. The fake client
// records every RPC and room update so a test can see which events the
// sweep touched after one of them failed.
function harness({ secret = 'cron-secret', rpcErrorFor = [], eventOverrides = {}, roomOverrides = {}, roomReadErrorFor = [], expireErrorFor = [], eventCount = 2, pageErrorAfter = null } = {}) {
  let handler;
  const hour = 60 * 60 * 1000;
  const events = Array.from({ length: eventCount }, (_, i) => ({
    id: i + 1, lynk_room_id: `room-${i + 1}`, start_date: new Date(Date.now() - hour).toISOString(), end_date: null, status: 'active',
  }));
  const pageCursors = [];
  events.forEach(e => Object.assign(e, eventOverrides[e.id] || {}));
  const rooms = events.map(e => ({ id: e.id, uuid: e.lynk_room_id, status: 'open', ...roomOverrides[e.id] }));
  const ended = [];
  const rpcCalls = [];
  const opened = [];
  const client = {
    rpc: async (name, args) => {
      if (name === 'expire_event_lynk_room') {
        if (expireErrorFor.includes(args.p_event_id)) return { data: null, error: { message: 'cleanup unavailable' } };
        const room = rooms.find(r => r.id === args.p_event_id);
        if (!room || room.status === 'ended') return { data: false, error: null };
        room.status = 'ended'; ended.push(room.uuid);
        return { data: true, error: null };
      }
      rpcCalls.push(args.p_event_id);
      if (rpcErrorFor.includes(args.p_event_id)) {
        return { data: null, error: { code: '42883', message: 'function does not exist' } };
      }
      return { data: { ok: true }, error: null };
    },
    from: (table) => {
      const eq = {};
      let update = null;
      let after = 0;
      let limit = Infinity;
      const q = {
        select: () => q,
        not: () => q,
        limit: (n) => { limit = n; return q; },
        order: () => q,
        gt: (k, v) => { after = v; return q; },
        neq: () => q,
        eq: (k, v) => { eq[k] = v; return q; },
        update: (v) => { update = v; return q; },
        maybeSingle: async () => {
          if (update?.status === 'open') opened.push(eq.uuid);
          const room = rooms.find(r => r.uuid === eq.uuid);
          if (roomReadErrorFor.includes(room?.id)) return { data: null, error: { message: 'offline' } };
          if (update && room) {
            if (room.status === 'ended') return { data: null, error: null };
            Object.assign(room, update); ended.push(room.uuid);
          }
          return { data: room || null, error: null };
        },
        then: (ok, fail) => {
          if (table === 'events') pageCursors.push(after);
          const result = table === 'events'
            ? pageErrorAfter === after ? { data: null, error: { message: 'page unavailable' } }
              : { data: events.filter(e => e.id > after).sort((a,b) => a.id-b.id).slice(0, limit), error: null }
            : { data: [], error: null };
          return Promise.resolve(result).then(ok, fail);
        },
      };
      return q;
    },
  };
  const env = { CRON_SECRET: secret, SUPABASE_URL: 'http://db', SUPABASE_SERVICE_ROLE_KEY: 'key' };
  const source = ts.transpileModule(
    fs.readFileSync(`${__dirname}/index.ts`, 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  vm.runInNewContext(source, {
    exports: {}, console: { log() {}, warn() {}, error() {} }, Response, Date,
    Deno: { env: { get: (k) => env[k] }, serve: (fn) => { handler = fn; } },
    require: (name) => {
      if (!name.includes('event-access')) return { createClient: () => client };
      const exports = {};
      vm.runInNewContext(ts.transpileModule(fs.readFileSync(path.join(__dirname, '../_shared/event-access.ts'), 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText, { exports, Date, Number, Math });
      return exports;
    },
  });
  const sweep = async (headers = {}) => {
    const res = await handler(new Request('http://test', { method: 'POST', headers }));
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  };
  return { sweep, rpcCalls, opened, ended, rooms, pageCursors };
}

test('an unset CRON_SECRET rejects every request with 500', async () => {
  const h = harness({ secret: '' });
  const got = await h.sweep({ 'x-cron-secret': '' });
  assert.equal(got.status, 500);
  assert.equal(h.rpcCalls.length, 0);
});

test('a wrong x-cron-secret is 401 and touches nothing', async () => {
  const h = harness();
  const got = await h.sweep({ 'x-cron-secret': 'nope' });
  assert.equal(got.status, 401);
  assert.equal(h.rpcCalls.length, 0);
});

test('a Bearer token alone is not accepted', async () => {
  const h = harness();
  const got = await h.sweep({ authorization: 'Bearer cron-secret' });
  assert.equal(got.status, 401);
});

test('the right x-cron-secret runs the sweep', async () => {
  const h = harness();
  const got = await h.sweep({ 'x-cron-secret': 'cron-secret' });
  assert.equal(got.status, 200);
  assert.deepEqual(h.rpcCalls, [1, 2]);
  assert.deepEqual(got.body.failed, []);
});

test('the sweep never opens a room on its own, even after start_date', async () => {
  // Both events started an hour ago. Only a host's start opens the room.
  const h = harness();
  await h.sweep({ 'x-cron-secret': 'cron-secret' });
  assert.deepEqual(h.opened, []);
});

test('a failed lifecycle sync is reported as 500 and the sweep keeps going', async () => {
  const h = harness({ rpcErrorFor: [1] });
  const got = await h.sweep({ 'x-cron-secret': 'cron-secret' });
  assert.equal(got.status, 500);
  assert.equal(got.body.ok, false);
  assert.deepEqual(got.body.failed, [1]);
  assert.deepEqual(h.rpcCalls, [1, 2]);

});

const migrations = path.join(__dirname, '../../migrations');
const read = (name) => fs.readFileSync(path.join(migrations, name), 'utf8');

test('the cron migration schedules the sweep and sends x-cron-secret', () => {
  const sql = read('20261003160000_event_lynk_lifecycle_cron.sql');
  assert.match(sql, /create or replace function public\.cron_event_lynk_lifecycle_sweep\(\)/);
  assert.match(sql, /security definer/);
  assert.match(sql, /set search_path = ''/);
  assert.match(sql, /from vault\.decrypted_secrets[\s\S]*name = 'CRON_SECRET'/);
  assert.match(sql, /'x-cron-secret', v_secret/);
  assert.match(sql, /functions\/v1\/process-event-lynk-lifecycle'/);
  assert.doesNotMatch(sql, /Bearer/);
  assert.match(sql, /cron\.unschedule\('event-lynk-lifecycle-every-5min'\)/);
  assert.match(sql, /cron\.schedule\(\s*'event-lynk-lifecycle-every-5min',\s*'\*\/5 \* \* \* \*',\s*'select public\.cron_event_lynk_lifecycle_sweep\(\);'/);
  assert.match(sql, /revoke all on function public\.cron_event_lynk_lifecycle_sweep\(\) from anon/);
});

test('room_invite is added to the notification enum in its own migration', () => {
  const sql = read('20261003155900_notifications_room_invite_type.sql');
  assert.match(sql, /ALTER TYPE public\.enum_notifications_type ADD VALUE IF NOT EXISTS 'room_invite';/);
  // ADD VALUE cannot share a transaction with a statement that uses the
  // value, so the file holds that one statement and nothing else.
  const statements = sql.replace(/--.*$/gm, '').split(';').map((x) => x.trim()).filter(Boolean);
  assert.equal(statements.length, 1);
});


test('future event rooms survive their original five-minute creation deadline without a host', async () => {
  const now = Date.now();
  const h = harness({
    eventOverrides: { 1: { start_date: new Date(now + 86400000).toISOString(), end_date: new Date(now + 90000000).toISOString() } },
    roomOverrides: { 1: { created_at: new Date(now - 3600000).toISOString(), ends_at: new Date(now - 3300000).toISOString() } },
  });
  await h.sweep({ 'x-cron-secret': 'cron-secret' });
  assert.deepEqual(h.ended, []);
  assert.deepEqual(h.opened, []);
});

test('shifted plan expiry and cancellation end rooms even without a host; repeated sweeps are idempotent', async () => {
  const now = Date.now();
  const h = harness({
    eventOverrides: {
      1: { start_date: new Date(now - 3600000).toISOString(), end_date: new Date(now + 3600000).toISOString() },
      2: { status: 'cancelled' },
    },
    roomOverrides: { 1: { created_at: new Date(now - 7200000).toISOString(), ends_at: new Date(now - 6900000).toISOString() } },
  });
  assert.equal((await h.sweep({ 'x-cron-secret': 'cron-secret' })).body.changed, 2);
  assert.equal((await h.sweep({ 'x-cron-secret': 'cron-secret' })).body.changed, 0);
  assert.deepEqual(h.ended, ['room-1', 'room-2']);
  assert.deepEqual(h.opened, []);
});

test('event end caps unlimited rooms and null end retains the existing six-hour convention', async () => {
  const now = Date.now();
  const h = harness({ eventOverrides: {
    1: { end_date: new Date(now - 1).toISOString() },
    2: { start_date: new Date(now - 7 * 3600000).toISOString() },
  } });
  assert.equal((await h.sweep({ 'x-cron-secret': 'cron-secret' })).body.changed, 2);
});

test('room read failures and invalid schedules are reported without unsafe updates', async () => {
  const h = harness({ roomReadErrorFor: [1], eventOverrides: { 2: { start_date: null } } });
  const result = await h.sweep({ 'x-cron-secret': 'cron-secret' });
  assert.equal(result.status, 500);
  assert.deepEqual(result.body.failed, [1, 2]);
  assert.deepEqual(h.ended, []);
});


test('atomic expiry failure reports the event and continues cleanup of other events', async () => {
  const h = harness({ expireErrorFor: [1], eventOverrides: { 1: { status: 'cancelled' }, 2: { status: 'cancelled' } } });
  const result = await h.sweep({ 'x-cron-secret': 'cron-secret' });
  assert.equal(result.status, 500);
  assert.deepEqual(result.body.failed, [1]);
  assert.equal(result.body.changed, 1);
  assert.deepEqual(h.ended, ['room-2']);
  assert.equal(h.rooms[0].status, 'open');
});


test('stable keyset pages reach expired events after the first 500 old linked events', async () => {
  const h = harness({ eventCount: 501, eventOverrides: { 501: { status: 'cancelled' } } });
  const result = await h.sweep({ 'x-cron-secret': 'cron-secret' });
  assert.equal(result.status, 200);
  assert.equal(result.body.checked, 501);
  assert.equal(result.body.changed, 1);
  assert.deepEqual(h.pageCursors, [0, 500]);
  assert.equal(new Set(h.rpcCalls).size, 501);
  assert.deepEqual(h.ended, ['room-501']);
});

test('later page errors report partial progress instead of claiming a complete sweep', async () => {
  const h = harness({ eventCount: 501, pageErrorAfter: 500, eventOverrides: { 1: { status: 'cancelled' } } });
  const result = await h.sweep({ 'x-cron-secret': 'cron-secret' });
  assert.equal(result.status, 500);
  assert.equal(result.body.ok, false);
  assert.equal(result.body.checked, 500);
  assert.equal(result.body.changed, 1);
  assert.equal(result.body.error, 'page unavailable');
  assert.deepEqual(h.pageCursors, [0, 500]);
  assert.equal(h.rpcCalls.includes(501), false);
});
