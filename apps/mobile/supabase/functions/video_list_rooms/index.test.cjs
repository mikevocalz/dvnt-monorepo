// Executes the real handler/shared access rules against synthetic PostgREST.
// No service, provider, name, credential or production data is read or changed.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const NOW = Date.parse('2026-11-08T12:00:00.000Z');
const iso = (offset = 0) => new Date(NOW + offset).toISOString();
const HOUR = 3600000;
const room = (id = 1, extra = {}) => ({ id, uuid: `room-${id}`, room_kind: 'lynk', status: 'open',
  is_public: true, created_by: 'host', created_at: iso(-HOUR), ends_at: null, participant_count: 500, ...extra });
const member = (id = 1, extra = {}) => ({ id, room_id: 1, user_id: 'host', role: 'host', status: 'active',
  joined_at: iso(-60000), last_seen_at: iso(-10000), left_at: null, ...extra });
const event = (id = 1, extra = {}) => ({ id, host_id: 'event-host', lynk_room_id: `room-${id}`,
  visibility: 'public', status: 'active', ticketing_enabled: true, start_date: iso(-HOUR), end_date: iso(2 * HOUR), ...extra });
const lifecycle = (event_id = 1, extra = {}) => ({ event_id, room_uuid: `room-${event_id}`, state: 'live', ...extra });
const admission = (id = 1, extra = {}) => ({ id, event_id: id, user_id: 'viewer', status: 'active', category: 'admission', ...extra });

function fixture({ actor = 'viewer', tables: overrides = {}, cap = 1000, failPage = {}, duplicateTable, onRead, session = true } = {}) {
  const tables = { video_rooms: [room()], video_room_members: [member()], video_room_invites: [], events: [],
    event_lynk_lifecycle: [], event_co_organizers: [], tickets: [], event_invites: [], users: [], ...overrides };
  let handler, time = NOW;
  const calls = [];
  class Clock extends Date { constructor(...args) { super(...(args.length ? args : [time])); } static now() { return time; } }
  const db = { from(table) {
    assert.ok(Object.hasOwn(tables, table), `Unexpected table: ${table}`);
    const filters = [], presenceFilters = [], orders = [];
    let select = '', limit = Infinity, cursor = null;
    const add = (key, predicate) => {
      (key.startsWith('presence.') ? presenceFilters : filters).push((row) => predicate(row[key.replace(/^presence\./, '')]));
      return q;
    };
    const execute = () => {
      calls.push({ table, select, cursor, limit, orders });
      onRead?.({ table, select, cursor, advance: (ms) => { time += ms; } });
      if (Object.hasOwn(failPage, table) && (failPage[table] === 'all' || cursor === failPage[table])) {
        return { data: null, error: { message: 'synthetic page failure' } };
      }
      let rows = tables[table].filter((r) => filters.every((filter) => filter(r)));
      if (select.includes('video_room_members!inner')) {
        rows = rows.filter((r) => tables.video_room_members.some((m) => m.room_id === r.id && presenceFilters.every((filter) => filter(m))));
      } else assert.equal(presenceFilters.length, 0, 'presence filter must be backed by inner join');
      rows = [...rows].sort((a, b) => {
        for (const [key, ascending] of orders) if (a[key] !== b[key]) return (a[key] > b[key] ? 1 : -1) * (ascending ? 1 : -1);
        return 0;
      }).slice(0, Math.min(limit, typeof cap === 'number' ? cap : cap[table] ?? 1000));
      // Mimic PostgREST projections: lifecycle really has event_id, NOT id.
      const project = (r) => select.includes('*') ? { ...r } : Object.fromEntries(select.split(',').map(k => k.trim()).filter(k => Object.hasOwn(r, k)).map(k => [k, r[k]]));
      const data = rows.map(project);
      if (duplicateTable === table && data.length) data.push({ ...data[0] });
      return { data, error: null };
    };
    const q = {
      select: (value) => { select = value; return q; },
      eq: (key, value) => add(key, (x) => x === value),
      in: (key, values) => add(key, (x) => values.includes(x)),
      is: (key, value) => add(key, (x) => x === value),
      gt: (key, value) => { if (!key.startsWith('presence.')) cursor = value; return add(key, (x) => x != null && x > value); },
      gte: (key, value) => add(key, (x) => x != null && x >= value),
      lte: (key, value) => add(key, (x) => x != null && x <= value),
      or: (value) => { const recent = value.match(/ended_at.gte.([^)]*)/)[1]; filters.push(r => r.status === 'open' || (r.status === 'ended' && r.ended_at >= recent)); return q; },
      order: (key, options) => { orders.push([key, options.ascending]); return q; },
      limit: (n) => { limit = n; return q; },
      then: (ok, bad) => Promise.resolve(execute()).then(ok, bad),
    };
    return q;
  } };
  const load = (file) => {
    const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const exports = {};
    const req = (name) => {
      if (name.includes('supabase-js')) return { createClient: () => db };
      if (name.endsWith('/verify-session.ts')) return { verifySessionDetailed: async () => session ? { ok: true, userId: actor } : { ok: false, reason: 'expired' } };
      if (!name.startsWith('.')) throw new Error(`External access forbidden: ${name}`);
      return load(path.resolve(path.dirname(file), name));
    };
    new Function('exports', 'require', 'Deno', 'Date', 'console', output)(exports, req,
      { env: { get: () => 'synthetic-only' }, serve: (fn) => { handler = fn; } }, Clock, { error() {} });
    return exports;
  };
  load(path.join(__dirname, 'index.ts'));
  return { calls, tables, invoke: async (body = {}, auth = true) => {
    const response = await handler(new Request('https://fixture.invalid/list', {
      method: 'POST', headers: auth ? { Authorization: 'Bearer synthetic-only' } : {}, body: JSON.stringify(body),
    }));
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return response.json();
  } };
}
const list = async (f, body = {}) => { const response = await f.invoke(body); assert.equal(response.ok, true, JSON.stringify(response)); return response.data.rooms; };

test('signed-in-only discovery fails without auth or an active session', async () => {
  assert.equal((await fixture().invoke({}, false)).error.code, 'unauthorized');
  assert.equal((await fixture({ session: false }).invoke()).error.code, 'unauthorized');
});

test('live requires actual current host presence; counts and creation time are never evidence', async () => {
  for (const extra of [
    { last_seen_at: null }, { last_seen_at: 'invalid' }, { last_seen_at: iso(1) },
    { last_seen_at: iso(-90000) }, { last_seen_at: iso(-HOUR) },
    { left_at: iso(-1000) }, { status: 'left' }, { status: 'kicked' }, { status: 'banned' },
    { role: 'speaker' }, { role: 'moderator' }, { role: 'participant' },
  ]) {
    const f = fixture({ tables: { video_room_members: [member(1, extra)] } });
    assert.deepEqual(await list(f, { discoveryVersion: 2 }), [], JSON.stringify(extra));
  }
  for (const role of ['host', 'co-host']) {
    const rows = await list(fixture({ tables: { video_room_members: [member(1, { role })] } }));
    assert.equal(rows[0].availability, 'live');
    assert.equal(rows[0].isLive, true);
    assert.equal(rows[0].listeners, 1, 'stored count must not inflate live audience');
    assert.equal(rows[0].presenceKnown, true);
    assert.equal(rows[0].observedAt, iso());
    assert.equal(rows[0].presenceExpiresAt, iso(80000));
    assert.equal(rows[0].endsAt, null, 'unlimited null deadline stays unlimited');
  }
});

test('only the newest membership per user counts, including leave and demotion', async () => {
  for (const extra of [{ status: 'left' }, { left_at: iso(-1) }, { role: 'participant' }, { last_seen_at: null }]) {
    const f = fixture({ cap: { video_room_members: 1 }, tables: { video_room_members: [member(1), member(2, extra)] } });
    assert.deepEqual(await list(f), []);
  }
  const rows = await list(fixture({ cap: { video_room_members: 1 }, tables: {
    video_room_members: [member(1, { status: 'left' }), member(2), member(3, { user_id: 'guest', role: 'participant' })],
  } }));
  assert.equal(rows[0].listeners, 2);
});

test('latest valid host heartbeat determines expiry, capped by the effective deadline', async () => {
  const f = fixture({ tables: { video_rooms: [room(1, { ends_at: iso(50000) })], video_room_members: [
    member(1, { last_seen_at: iso(-40000) }), member(2, { user_id: 'cohost', role: 'co-host', last_seen_at: iso(-1000) }),
  ] } });
  assert.equal((await list(f))[0].presenceExpiresAt, iso(50000));
  f.tables.video_rooms[0].ends_at = null;
  assert.equal((await list(f))[0].presenceExpiresAt, iso(89000));
});

test('legacy {}, v1 and string 2 never see inactive raw-open owner/invite rooms', async () => {
  for (const role of ['owner', 'invite']) {
    const f = fixture({ tables: { video_rooms: [room(1, { created_by: role === 'owner' ? 'viewer' : 'host', is_public: false })],
      video_room_members: [], video_room_invites: role === 'invite' ? [{ id: 'invite-1', room_id: 1, user_id: 'viewer' }] : [],
    } });
    for (const body of [{}, { discoveryVersion: 1 }, { discoveryVersion: '2' }, { discoveryVersion: 0, isOwner: true, isInvited: true }]) assert.deepEqual(await list(f, body), []);
    const [row] = await list(f, { discoveryVersion: 2 });
    assert.equal(row.availability, 'inactive');
    assert.equal(row.isLive, false);
    assert.equal(row.presenceExpiresAt, null);
    assert.equal(row.isOwner, role === 'owner');
    assert.equal(row.isInvited, role === 'invite');
  }
  const f = fixture({ tables: { video_room_members: [] } });
  assert.deepEqual(await list(f, { discoveryVersion: 2, isOwner: true, isInvited: true }), []);
});

test('owner management includes public inactive rooms, but a stranger cannot discover them', async () => {
  const tables = { video_rooms: [room(1, { created_by: 'viewer' })], video_room_members: [] };
  assert.equal((await list(fixture({ tables }), { discoveryVersion: 2 }))[0].isOwner, true);
  assert.deepEqual(await list(fixture({ actor: 'stranger', tables }), { discoveryVersion: 2 }), []);
});

test('expired or invalid plan deadlines cannot appear live; persisted history stays bounded', async () => {
  for (const ends_at of [iso(), iso(-1), 'invalid']) {
    const f = fixture({ tables: { video_rooms: [room(1, { ends_at, created_by: 'viewer' })] } });
    assert.deepEqual(await list(f), []);
    const [row] = await list(f, { discoveryVersion: 2 });
    assert.equal(row.availability, ends_at === 'invalid' ? 'unknown' : 'ended');
    assert.equal(row.isLive, false);
  }
  for (const [ended_at, count] of [[iso(-1000), 1], [iso(-25 * HOUR), 0], [iso(1), 0], [null, 0]]) {
    const f = fixture({ tables: { video_rooms: [room(1, { status: 'ended', ended_at })] } });
    const rows = await list(f);
    assert.equal(rows.length, count);
    if (count) assert.equal(rows[0].availability, 'ended');
  }
});

test('65 newer stale rooms cannot bury an older live room before public limit 50', async () => {
  const f = fixture({ tables: {
    video_rooms: [...Array.from({ length: 65 }, (_, i) => room(i + 2, { created_at: iso(-i * 1000) })), room()],
    video_room_members: [...Array.from({ length: 65 }, (_, i) => member(i + 2, { room_id: i + 2, last_seen_at: null })), member()],
  } });
  assert.deepEqual((await list(f)).map(r => r.id), ['room-1']);
  const query = f.calls.find(c => c.select.includes('!inner'));
  assert.equal(query.limit, 50);
});

test('live event admission cannot be bypassed by public visibility or a room invitation', async () => {
  for (const paid of [true, false]) {
    const f = fixture({ tables: {
      events: [event(1, { ticketing_enabled: paid })], event_lynk_lifecycle: [lifecycle()],
      video_room_invites: [{ id: 'invite', user_id: 'viewer', room_id: 1 }],
    } });
    assert.deepEqual(await list(f, { discoveryVersion: 2 }), []);
    f.tables.tickets.push(admission(1, { category: 'service' }));
    assert.deepEqual(await list(f), []);
    f.tables.tickets.push(admission(2, { event_id: 1 }));
    assert.equal((await list(f))[0].availability, 'live');
  }
});

test('shared organizer, paid admission and free invitation rules remain intact', async () => {
  const base = { events: [event()], event_lynk_lifecycle: [lifecycle()] };
  for (const extra of [{ tickets: [admission()] }, { tickets: [admission(1, { status: 'scanned' })] },
    { event_co_organizers: [{ id: 1, event_id: 1, user_id: 'viewer', accepted: true }] },
    { events: [event(1, { host_id: 'viewer' })] }]) assert.equal((await list(fixture({ tables: { ...base, ...extra } }))).length, 1);
  for (const category of ['product', 'service', 'coat_check']) assert.deepEqual(await list(fixture({ tables: { ...base, tickets: [admission(1, { category })] } })), []);
  for (const status of ['cancelled', 'refunded', 'transferred']) assert.deepEqual(await list(fixture({ tables: { ...base, tickets: [admission(1, { status })] } })), []);
  for (const extra of [
    { event_invites: [{ id: 1, event_id: 1, invited_user_id: 'viewer', status: 'pending' }] },
    { event_co_organizers: [{ id: 1, event_id: 1, user_id: 'viewer', accepted: false }] },
  ]) {
    assert.deepEqual(await list(fixture({ tables: { ...base, ...extra } })), [], 'paid event still needs ticket');
    assert.equal((await list(fixture({ tables: { ...base, ...extra, events: [event(1, { ticketing_enabled: false })] } }))).length, 1);
  }
});

test('scheduled/ready or terminal lifecycle cannot prove live, and explicit host start permits early live', async () => {
  for (const state of ['scheduled', 'ready', 'ended', 'cancelled', 'unknown']) {
    const f = fixture({ actor: 'event-host', tables: { video_rooms: [room(1, { created_by: 'event-host' })],
      events: [event()], event_lynk_lifecycle: [lifecycle(1, { state })] } });
    assert.deepEqual(await list(f), []);
    const [row] = await list(f, { discoveryVersion: 2 });
    assert.equal(row.isLive, false);
    assert.equal(row.availability, ['scheduled', 'ready'].includes(state) ? 'scheduled' : state === 'unknown' ? 'unknown' : 'ended');
  }
  const rows = await list(fixture({ tables: { events: [event(1, { start_date: iso(HOUR), end_date: iso(2 * HOUR) })],
    event_lynk_lifecycle: [lifecycle()], tickets: [admission()] } }));
  assert.equal(rows[0].availability, 'live', 'host started early');
});

test('event deadline shares creation allowance shift, explicit cap and no-end floor', async () => {
  const f = fixture({ tables: {
    video_rooms: [room(1, { created_at: iso(-24 * HOUR), ends_at: iso(-24 * HOUR + 300000) })],
    events: [event(1, { start_date: iso(-60000), end_date: iso(2 * HOUR) })], event_lynk_lifecycle: [lifecycle()], tickets: [admission()],
  } });
  assert.equal((await list(f))[0].endsAt, iso(240000));
  f.tables.events[0].end_date = iso(20000);
  assert.equal((await list(f))[0].presenceExpiresAt, iso(20000));
  f.tables.events[0].end_date = null;
  f.tables.events[0].start_date = iso(-HOUR);
  assert.equal((await list(f))[0].endsAt, iso(5 * HOUR));
  f.tables.video_rooms[0].ends_at = iso(-24 * HOUR + 10 * HOUR);
  assert.equal((await list(f))[0].endsAt, iso(9 * HOUR));
  f.tables.video_rooms[0].ends_at = null;
  assert.equal((await list(f))[0].endsAt, iso(5 * HOUR));
});

test('absent, orphan, duplicate and mismatched event/lifecycle links never become ordinary live rooms', async () => {
  const cases = [
    { events: [event()], event_lynk_lifecycle: [] },
    { events: [], event_lynk_lifecycle: [lifecycle()] },
    { events: [event(1, { lynk_room_id: null })], event_lynk_lifecycle: [lifecycle()] },
    { events: [event(1, { lynk_room_id: 'other-room' })], event_lynk_lifecycle: [lifecycle()] },
    { events: [event()], event_lynk_lifecycle: [lifecycle(1, { room_uuid: 'other-room' })] },
    { events: [event(), event(2, { lynk_room_id: 'room-1' })], event_lynk_lifecycle: [lifecycle()] },
    { events: [event()], event_lynk_lifecycle: [lifecycle(), lifecycle(2, { room_uuid: 'room-1' })] },
    { events: [event(1, { status: 'cancelled' })], event_lynk_lifecycle: [lifecycle()] },
    { events: [event(1, { start_date: null })], event_lynk_lifecycle: [lifecycle()] },
  ];
  for (const extra of cases) assert.deepEqual(await list(fixture({ tables: { ...extra, tickets: [admission(), admission(2)] } })), [], JSON.stringify(extra));
});

test('privacy regression: lifecycle cap ONE must not omit the second of two orphan rooms', async () => {
  const f = fixture({ cap: { event_lynk_lifecycle: 1 }, tables: {
    video_rooms: [room(), room(2)], video_room_members: [member(), member(2, { room_id: 2 })],
    events: [], event_lynk_lifecycle: [lifecycle(), lifecycle(2)],
  } });
  assert.deepEqual(await list(f, { discoveryVersion: 2 }), []);
  const scans = f.calls.filter(c => c.table === 'event_lynk_lifecycle');
  assert.deepEqual(scans.map(c => c.cursor), [null, 1, 2]);
  assert.ok(scans.every(c => c.orders[0][0] === 'event_id'));
});

test('lower server caps complete member, event, lifecycle, invitation and admission reads', async () => {
  const f = fixture({ cap: { video_room_members: 1, events: 1, event_lynk_lifecycle: 1, tickets: 1, event_invites: 1, event_co_organizers: 1, video_room_invites: 1 }, tables: {
    video_rooms: [room(), room(2)], video_room_members: [member(), member(2, { room_id: 2 })],
    events: [event(), event(2)], event_lynk_lifecycle: [lifecycle(), lifecycle(2)], tickets: [admission(), admission(2)],
    video_room_invites: [{ id: 1, room_id: 1, user_id: 'viewer' }, { id: 2, room_id: 2, user_id: 'viewer' }],
    event_invites: [{ id: 1, event_id: 1, invited_user_id: 'viewer', status: 'pending' }, { id: 2, event_id: 2, invited_user_id: 'viewer', status: 'pending' }],
    event_co_organizers: [{ id: 1, event_id: 1, user_id: 'viewer', accepted: false }, { id: 2, event_id: 2, user_id: 'viewer', accepted: false }],
  } });
  assert.deepEqual((await list(f)).map(r => r.id).sort(), ['room-1', 'room-2']);
  for (const table of ['video_room_members', 'events', 'event_lynk_lifecycle', 'tickets', 'video_room_invites', 'event_invites', 'event_co_organizers']) {
    assert.ok(f.calls.some(c => c.table === table && c.cursor === 2), `${table} complete final-empty page`);
  }
});

test('any failed first/later authoritative page returns endpoint failure, never a partial successful list', async () => {
  const tables = {
    video_rooms: [room(), room(2)], video_room_members: [member(), member(2, { room_id: 2 })],
    events: [event(), event(2)], event_lynk_lifecycle: [lifecycle(), lifecycle(2)], tickets: [admission(), admission(2)],
    video_room_invites: [{ id: 1, room_id: 1, user_id: 'viewer' }, { id: 2, room_id: 2, user_id: 'viewer' }],
    event_invites: [{ id: 1, event_id: 1, invited_user_id: 'viewer', status: 'pending' }, { id: 2, event_id: 2, invited_user_id: 'viewer', status: 'pending' }],
    event_co_organizers: [{ id: 1, event_id: 1, user_id: 'viewer', accepted: false }, { id: 2, event_id: 2, user_id: 'viewer', accepted: false }],
  };
  for (const table of ['video_room_members', 'events', 'event_lynk_lifecycle', 'tickets', 'video_room_invites', 'event_invites', 'event_co_organizers']) {
    for (const cursor of ['all', 1]) {
      const f = fixture({ tables, cap: { [table]: 1 }, failPage: { [table]: cursor } });
      const result = await f.invoke();
      assert.equal(result.ok, false, `${table}/${cursor}`);
      assert.equal(result.error.code, 'internal_error');
      assert.equal(result.data, undefined);
    }
  }
});

test('duplicate cursor keys fail closed instead of silently overwriting access evidence', async () => {
  for (const duplicateTable of ['video_room_members', 'events', 'event_lynk_lifecycle', 'tickets']) {
    const f = fixture({ duplicateTable, tables: { events: [event()], event_lynk_lifecycle: [lifecycle()], tickets: [admission()] } });
    assert.equal((await f.invoke()).ok, false, duplicateTable);
  }
});

module.exports = { fixture, room, member, event, lifecycle, admission, list, iso };

test('presence expires during final profile hydration, including legacy responses', async () => {
  for (const discoveryVersion of [undefined, 2]) {
    const f = fixture({ onRead: ({ table, advance }) => { if (table === 'users') advance(80001); } });
    assert.deepEqual(await list(f, { discoveryVersion }), []);
  }
  const f = fixture({ actor: 'host', onRead: ({ table, advance }) => { if (table === 'users') advance(80001); } });
  const [row] = await list(f, { discoveryVersion: 2 });
  assert.equal(row.availability, 'inactive');
  assert.equal(row.isLive, false);
  assert.equal(row.observedAt, iso(80001));
});

test('Resume has a durable ten-minute deadline after explicit host leave, not after each fetch', async () => {
  for (const age of [599999, 600000, 600001]) {
    const f = fixture({ actor: 'host', tables: { video_room_members: [member(1, {status:'left', left_at:iso(-age), last_seen_at:iso(-age-1000)})] } });
    const first = (await list(f, {discoveryVersion:2}))[0];
    const second = (await list(f, {discoveryVersion:2}))[0];
    assert.equal(first.availability, 'inactive');
    assert.equal(first.resumeExpiresAt, iso(600000-age));
    assert.equal(second.resumeExpiresAt, first.resumeExpiresAt);
  }
});
test('silent host disconnect starts Resume at heartbeat expiry; cohost extends live session', async () => {
  const f = fixture({ actor:'host', tables: { video_room_members: [member(1,{last_seen_at:iso(-90000)})] } });
  assert.equal((await list(f,{discoveryVersion:2}))[0].resumeExpiresAt,iso(600000));
  const cohost = fixture({actor:'host',tables:{ video_room_members:[
    member(1,{status:'left',left_at:iso(-HOUR)}), member(2,{user_id:'cohost',role:'co-host',last_seen_at:iso(-1000)})] }});
  const row=(await list(cohost,{discoveryVersion:2}))[0];
  assert.equal(row.availability,'live');assert.equal(row.resumeExpiresAt,iso(689000));
});
test('unstarted rooms use creation time and latest leave cannot be overruled by an older membership', async () => {
  const empty=fixture({actor:'host',tables:{video_rooms:[room(1,{created_at:iso(-300000)})],video_room_members:[]}});
  assert.equal((await list(empty,{discoveryVersion:2}))[0].resumeExpiresAt,iso(300000));
  const left=fixture({actor:'host',tables:{video_room_members:[member(1),member(2,{status:'left',left_at:iso(-600001)})]}});
  const row=(await list(left,{discoveryVersion:2}))[0];
  assert.equal(row.availability,'inactive');assert.equal(row.resumeExpiresAt,iso(-1));
});
