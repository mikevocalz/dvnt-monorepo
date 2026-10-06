const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Same loader shape as event-lynk-invite/index.test.cjs. The fake client
// records every RPC and room update so a test can see which events the
// sweep touched after one of them failed.
function harness({ secret = 'cron-secret', rpcErrorFor = [] } = {}) {
  let handler;
  const hour = 60 * 60 * 1000;
  const events = [
    { id: 1, lynk_room_id: 'room-1', start_date: new Date(Date.now() - hour).toISOString(), end_date: null, status: 'active' },
    { id: 2, lynk_room_id: 'room-2', start_date: new Date(Date.now() - hour).toISOString(), end_date: null, status: 'active' },
  ];
  const rpcCalls = [];
  const opened = [];
  const client = {
    rpc: async (name, args) => {
      rpcCalls.push(args.p_event_id);
      if (rpcErrorFor.includes(args.p_event_id)) {
        return { data: null, error: { code: '42883', message: 'function does not exist' } };
      }
      return { data: { ok: true }, error: null };
    },
    from: (table) => {
      const eq = {};
      let update = null;
      const q = {
        select: () => q,
        not: () => q,
        limit: () => q,
        neq: () => q,
        eq: (k, v) => { eq[k] = v; return q; },
        update: (v) => { update = v; return q; },
        maybeSingle: async () => {
          if (update?.status === 'open') opened.push(eq.uuid);
          return { data: { id: eq.uuid }, error: null };
        },
        then: (ok, fail) => Promise.resolve(
          table === 'events' ? { data: events, error: null } : { data: [], error: null },
        ).then(ok, fail),
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
    require: () => ({ createClient: () => client }),
  });
  const sweep = async (headers = {}) => {
    const res = await handler(new Request('http://test', { method: 'POST', headers }));
    const text = await res.text();
    let body = null;
    try { body = JSON.parse(text); } catch { body = text; }
    return { status: res.status, body };
  };
  return { sweep, rpcCalls, opened };
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
