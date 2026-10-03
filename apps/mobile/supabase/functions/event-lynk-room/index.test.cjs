const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

// Same loader shape as event-lynk-invite/index.test.cjs, except the two
// _shared modules that decide access are the real ones, transpiled the same
// way, so these tests exercise the production host and admission rules.
const SHARED = path.join(__dirname, '../_shared');
function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
function loadShared(name) {
  const exports = {};
  vm.runInNewContext(transpile(path.join(SHARED, name)), { exports, Date, Promise, Number, String, Error, Math });
  return exports;
}

const HOUR = 60 * 60 * 1000;

// In-memory PostgREST stand-in: eq / in / is / gte / limit filters, update
// and upsert that write back, and a fake sync_event_lynk_lifecycle that only
// creates a missing row (it never makes one live, like the migration).
function harness({ actor = 'host-auth', failTables = [], event = {}, room = {}, coOrganizers = [] } = {}) {
  let handler;
  const tables = {
    events: [{
      id: 9, host_id: 'host-auth', visibility: 'private', status: 'active', ticketing_enabled: true,
      start_date: new Date(Date.now() + 2 * HOUR).toISOString(),
      end_date: new Date(Date.now() + 5 * HOUR).toISOString(),
      lynk_room_id: 'room-uuid', title: 'Basement Set', ...event,
    }],
    event_co_organizers: coOrganizers,
    tickets: ['ann', 'bo', 'cy', 'late'].map((u) => ({ event_id: 9, user_id: `${u}-auth`, status: 'active', category: 'admission' })),
    event_invites: [],
    event_lynk_lifecycle: [],
    event_lynk_waiting: [],
    video_rooms: [{ uuid: 'room-uuid', status: 'open', ...room }],
    video_room_members: [],
    users: [
      { auth_id: 'ann-auth', username: 'ann', first_name: 'Ann', last_name: 'Lee', avatar: { url: 'a.png' } },
      { auth_id: 'bo-auth', username: 'bo', first_name: null, last_name: null, avatar: null },
    ],
  };
  const writes = [];
  const client = {
    rpc: async (name, args) => {
      if (name !== 'sync_event_lynk_lifecycle') throw new Error(`unexpected rpc ${name}`);
      if (!tables.event_lynk_lifecycle.some((r) => r.event_id === args.p_event_id)) {
        tables.event_lynk_lifecycle.push({ event_id: args.p_event_id, state: 'scheduled' });
      }
      return { data: { ok: true }, error: null };
    },
    from: (table) => {
      const filters = [];
      let lim = Infinity;
      let op = null;
      const match = () => (tables[table] || []).filter((r) => filters.every((f) => f(r)));
      const run = () => {
        if (failTables.includes(table)) return { data: null, error: { message: `${table} offline` } };
        if (op?.kind === 'update') {
          const rows = match();
          rows.forEach((r) => Object.assign(r, op.value));
          writes.push({ table, kind: 'update', value: op.value, count: rows.length });
          return { data: rows.map((r) => ({ ...r })), error: null };
        }
        if (op?.kind === 'upsert') {
          const v = op.value;
          const existing = tables[table].find((r) => r.event_id === v.event_id && r.user_id === v.user_id);
          if (existing) Object.assign(existing, v);
          else tables[table].push({ joined_at: v.last_seen_at, admitted_at: null, ...v });
          writes.push({ table, kind: 'upsert', value: v });
          return { data: null, error: null };
        }
        return { data: match().slice(0, lim), error: null };
      };
      const q = {
        select: () => q,
        order: () => q,
        eq: (k, v) => { filters.push((r) => String(r[k]) === String(v)); return q; },
        in: (k, v) => { filters.push((r) => v.map(String).includes(String(r[k]))); return q; },
        is: (k, v) => { filters.push((r) => (r[k] ?? null) === v); return q; },
        gte: (k, v) => { filters.push((r) => String(r[k]) >= String(v)); return q; },
        limit: (n) => { lim = n; return q; },
        update: (value) => { op = { kind: 'update', value }; return q; },
        upsert: (value) => { op = { kind: 'upsert', value }; return q; },
        maybeSingle: async () => {
          const res = run();
          return res.error ? res : { data: (res.data || [])[0] ?? null, error: null };
        },
        then: (ok, fail) => Promise.resolve(run()).then(ok, fail),
      };
      return q;
    },
  };
  const shared = {
    'event-access.ts': loadShared('event-access.ts'),
    'event-lynk-host.ts': loadShared('event-lynk-host.ts'),
  };
  let who = actor;
  vm.runInNewContext(transpile(path.join(__dirname, 'index.ts')), {
    exports: {}, console: { log() {}, warn() {}, error() {} }, Response, Date,
    Deno: { env: { get: () => 'test' }, serve: (fn) => { handler = fn; } },
    require: (name) => {
      if (name.includes('supabase-js')) return { createClient: () => client };
      const base = path.basename(name);
      if (shared[base]) return shared[base];
      return {
        verifySession: async () => who,
        corsHeaders: () => ({}),
        optionsResponse: () => new Response(null, { status: 204 }),
      };
    },
  });
  const call = async (as, body) => {
    who = as;
    const res = await handler(new Request('http://test', { method: 'POST', body: JSON.stringify(body) }));
    return { status: res.status, body: await res.json() };
  };
  return {
    tables, writes,
    wait: (as) => call(as, { action: 'wait', room_id: 'room-uuid' }),
    list: (as = 'host-auth') => call(as, { action: 'list', event_id: 9 }),
    start: (as = 'host-auth') => call(as, { action: 'start', event_id: 9 }),
    state: () => tables.event_lynk_lifecycle.find((r) => r.event_id === 9)?.state ?? null,
  };
}

test('a ticket holder who opens the room before the host starts waits, and the host sees them', async () => {
  const h = harness();
  const got = await h.wait('ann-auth');
  assert.equal(got.status, 200);
  assert.equal(got.body.admitted, false);
  assert.equal(got.body.state, 'scheduled');
  assert.deepEqual(h.tables.event_lynk_waiting.map((r) => r.user_id), ['ann-auth']);
  const listed = await h.list();
  assert.equal(listed.status, 200);
  assert.equal(listed.body.count, 1);
  assert.deepEqual(listed.body.waiting.map((w) => [w.username, w.displayName, w.avatar]), [['ann', 'Ann Lee', 'a.png']]);
});

test('the clock alone never admits a guest: past start_date with no host start still waits', async () => {
  const h = harness({ event: { start_date: new Date(Date.now() - HOUR).toISOString() } });
  const got = await h.wait('ann-auth');
  assert.equal(got.body.admitted, false);
});

test('a guest with no ticket is refused, not parked in the waiting room', async () => {
  const h = harness();
  const got = await h.wait('stranger-auth');
  assert.equal(got.status, 403);
  assert.equal(got.body.reason, 'event_ticket_required');
  assert.equal(h.tables.event_lynk_waiting.length, 0);
});

test('host start admits everyone waiting and makes the room live', async () => {
  const h = harness();
  await h.wait('ann-auth');
  await h.wait('bo-auth');
  const started = await h.start();
  assert.equal(started.status, 200);
  assert.equal(started.body.started, true);
  assert.equal(started.body.admitted, 2);
  assert.equal(h.state(), 'live');
  for (const u of ['ann-auth', 'bo-auth']) {
    const again = await h.wait(u);
    assert.equal(again.body.admitted, true, `${u} should be admitted`);
  }
  assert.equal((await h.list()).body.count, 0);
});

test('a host may start well before start_date', async () => {
  const h = harness({ event: { start_date: new Date(Date.now() + 3 * 24 * HOUR).toISOString(), end_date: null } });
  const started = await h.start();
  assert.equal(started.status, 200);
  assert.equal(h.state(), 'live');
});

test('a guest who arrives after the start goes straight in', async () => {
  const h = harness();
  await h.start();
  const got = await h.wait('late-auth');
  assert.equal(got.body.admitted, true);
  assert.equal(h.tables.event_lynk_waiting.length, 0);
});

test('starting twice is idempotent', async () => {
  const h = harness();
  await h.start();
  const again = await h.start();
  assert.equal(again.status, 200);
  assert.equal(again.body.started, false);
  assert.equal(h.state(), 'live');
});

test('a non-host cannot start or list, including a pending or scanner co-organizer', async () => {
  const h = harness({
    coOrganizers: [
      { event_id: 9, user_id: 'pending-auth', role: 'admin', accepted: false },
      { event_id: 9, user_id: 'scanner-auth', role: 'scanner', accepted: true },
    ],
  });
  for (const who of ['ann-auth', 'pending-auth', 'scanner-auth']) {
    const got = await h.start(who);
    assert.equal(got.status, 403, who);
    assert.equal((await h.list(who)).status, 403, who);
  }
  assert.equal(h.state(), null);
});

test('an accepted editor co-organizer can start', async () => {
  const h = harness({ coOrganizers: [{ event_id: 9, user_id: 'ed-auth', role: 'editor', accepted: true }] });
  const got = await h.start('ed-auth');
  assert.equal(got.status, 200);
  assert.equal(h.state(), 'live');
});

test('start is refused for a cancelled event, an ended event and an ended room', async () => {
  const cancelled = harness({ event: { status: 'cancelled' } });
  assert.equal((await cancelled.start()).status, 409);
  const ended = harness({ event: { start_date: new Date(Date.now() - 5 * HOUR).toISOString(), end_date: new Date(Date.now() - HOUR).toISOString() } });
  assert.equal((await ended.start()).status, 409);
  const roomGone = harness({ room: { status: 'ended' } });
  assert.equal((await roomGone.start()).body.reason, 'room_ended');
  for (const h of [cancelled, ended, roomGone]) assert.notEqual(h.state(), 'live');
});

test('read errors fail closed', async () => {
  const coFail = harness({ failTables: ['event_co_organizers'] });
  const got = await coFail.start('ed-auth');
  assert.equal(got.status, 500);
  assert.equal(coFail.state(), null);

  const lifecycleFail = harness({ failTables: ['event_lynk_lifecycle'] });
  const waited = await lifecycleFail.wait('ann-auth');
  assert.equal(waited.status, 500);
  assert.equal(lifecycleFail.tables.event_lynk_waiting.length, 0);

  const ticketsFail = harness({ failTables: ['tickets'] });
  assert.equal((await ticketsFail.wait('ann-auth')).status, 500);
});

test('mass admit does not bypass capacity: start writes no room membership', async () => {
  const h = harness();
  for (const u of ['ann-auth', 'bo-auth', 'cy-auth']) await h.wait(u);
  await h.start();
  // Only lifecycle and waiting rows change. Seats are taken one by one in
  // video_join_room, which each admitted client calls next.
  assert.deepEqual([...new Set(h.writes.map((w) => w.table))].sort(), ['event_lynk_lifecycle', 'event_lynk_waiting']);
  assert.equal(h.tables.video_room_members.length, 0);

  // ...and in video_join_room the capacity gate still runs after the event
  // admission check for every non-call join.
  const join = fs.readFileSync(path.join(__dirname, '../video_join_room/index.ts'), 'utf8');
  const access = join.indexOf('resolveEventRoomAccess(supabase, room, userId)');
  const capacity = join.indexOf('participantCount >= room.max_participants');
  const insert = join.indexOf('.from("video_room_members")\n          .insert(');
  assert.ok(access > 0 && capacity > access && insert > capacity, 'capacity check must sit between admission and the member insert');
});

test('the lifecycle migration never makes a room live on its own', () => {
  const sql = fs.readFileSync(path.join(__dirname, '../../migrations/20261002210000_event_lynk_lifecycle.sql'), 'utf8');
  const fn = sql.slice(sql.indexOf('CREATE OR REPLACE FUNCTION public.sync_event_lynk_lifecycle'));
  // 'live' only appears as "keep what is there", never as an assigned value.
  assert.doesNotMatch(fn, /THEN 'live'/);
  assert.match(fn, /ELSE event_lynk_lifecycle\.state END/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.event_lynk_waiting/);
  assert.match(sql, /ALTER TABLE public\.event_lynk_waiting ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /REVOKE ALL ON public\.event_lynk_waiting FROM PUBLIC, anon, authenticated/);
});
