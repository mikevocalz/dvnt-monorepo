const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');

const ROOM_ID = '00000000-0000-4000-8000-000000000002';
const settle = () => new Promise((resolve) => setImmediate(resolve));
const code = ts.transpileModule(fs.readFileSync(`${__dirname}/index.ts`, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

// Actual handler, wholly synthetic DB, auth, HTTP and timers. No live writes,
// issued credentials, media sessions, or device capture are involved.
function fixture(overrides = {}) {
  const state = {
    actor: 'fixture-host', fetchMode: 'ok', roleError: null,
    failures: new Set(), trace: [], logs: [], timers: new Map(), fetchCalls: [],
    tables: {
      users: [{ id: 7, auth_id: 'fixture-host' }, { id: 8, auth_id: 'fixture-guest' }],
      video_rooms: [{ id: 3, uuid: ROOM_ID, status: 'open', created_by: 'fixture-host', fishjam_room_id: 'fixture-legacy', ended_at: null, participant_count: 2 }],
      video_room_members: [{ room_id: 3, user_id: 'fixture-host', role: 'host', status: 'active' }, { room_id: 3, user_id: 'fixture-guest', role: 'participant', status: 'active' }],
      video_room_tokens: [{ room_id: 3, revoked_at: null }],
      video_room_events: [],
    },
    ...overrides,
  };
  const db = {
    from(table) {
      let operation = 'read';
      let patch;
      const filters = [];
      let executed;
      function run() {
        if (executed) return executed;
        const key = `${operation}:${table}`;
        state.trace.push(key);
        if (state.failures.has(key)) {
          executed = Promise.resolve({ data: null, error: { message: `fixture failure ${key}` } });
          return executed;
        }
        if (operation === 'update' && table === 'video_rooms' && state.beforePersist) {
          state.beforePersist();
          state.beforePersist = null;
        }
        const matches = state.tables[table].filter((row) => filters.every((match) => match(row)));
        if (operation === 'update') matches.forEach((row) => Object.assign(row, patch));
        if (operation === 'insert') {
          const row = { id: state.tables[table].length + 1, ...patch };
          state.tables[table].push(row);
          executed = Promise.resolve({ data: { ...row }, error: null });
        } else {
          executed = Promise.resolve({ data: matches[0] ? { ...matches[0] } : null, error: null });
        }
        return executed;
      }
      const query = {
        select: () => query,
        eq: (key, value) => { filters.push((row) => row[key] === value); return query; },
        is: (key, value) => { filters.push((row) => row[key] === value); return query; },
        limit: () => query,
        update: (value) => { operation = 'update'; patch = value; return query; },
        insert: (value) => { operation = 'insert'; patch = value; return query; },
        single: run, maybeSingle: run,
        then: (resolve, reject) => run().then(resolve, reject),
      };
      return query;
    },
    rpc: async (_name, input) => {
      state.beforeRole?.();
      return {
        data: state.tables.video_room_members.find((row) => row.user_id === input.p_user_id && row.room_id === input.p_room_id && row.status === 'active')?.role ?? null,
        error: state.roleError,
      };
    },
  };
  let handler;
  const requireFixture = (name) => {
    if (name.includes('supabase-js')) return { createClient: () => db };
    if (name.includes('verify-session')) return { verifySessionDetailed: async () => ({ ok: true, userId: state.actor }) };
    if (name.includes('zod')) return require('zod');
    throw new Error(`Unexpected import; live access forbidden: ${name}`);
  };
  const fetchFixture = async (url, options) => {
    state.trace.push('legacy:delete');
    state.fetchCalls.push({ url, options });
    assert.equal(state.tables.video_rooms[0].status, 'ended', 'terminal room state persisted before legacy request');
    if (state.fetchMode === 'hung') return new Promise(() => {});
    if (state.fetchMode === 'network') throw new Error('fixture legacy offline');
    const status = state.fetchMode === 'ok' ? 204 : state.fetchMode;
    return { ok: status >= 200 && status < 300, status };
  };
  const setTimeoutFixture = (callback, delay) => {
    assert.equal(delay, 2000, 'legacy timeout is bounded at two seconds');
    const handle = {};
    state.timers.set(handle, callback);
    return handle;
  };
  new Function('exports', 'require', 'Deno', 'fetch', 'setTimeout', 'clearTimeout', 'console', code)(
    {}, requireFixture,
    { env: { get: () => 'fixture-placeholder' }, serve: (callback) => { handler = callback; } },
    fetchFixture, setTimeoutFixture, (handle) => state.timers.delete(handle),
    { log: (...args) => state.logs.push(args), error: (...args) => state.logs.push(args) },
  );
  return {
    state,
    async invoke() {
      const response = await handler(new Request('https://fixture.invalid/video_end_room', {
        method: 'POST', headers: { Authorization: 'Bearer fixture-session', 'Content-Type': 'application/json' }, body: JSON.stringify({ roomId: ROOM_ID }),
      }));
      return response.json();
    },
    expire() { for (const callback of [...state.timers.values()]) callback(); },
  };
}

test('hung legacy DELETE cannot delay persisted end and the response is bounded', async () => {
  const room = fixture({ fetchMode: 'hung' });
  const pending = room.invoke();
  await settle();
  assert.equal(room.state.tables.video_rooms[0].status, 'ended');
  assert.ok(room.state.tables.video_room_members.every((member) => member.status === 'left'));
  assert.ok(room.state.tables.video_room_tokens.every((token) => token.revoked_at));
  assert.equal(room.state.tables.video_room_events.length, 1);
  assert.equal(room.state.timers.size, 1);
  room.expire();
  const response = await pending;
  assert.equal(response.ok, true);
  assert.equal(response.data.ended, true);
  assert.equal(response.data.cleanupComplete, false);
  assert.deepEqual(response.data.cleanupWarnings, ['legacy_media_cleanup_failed']);
  assert.equal(room.state.fetchCalls[0].options.signal.aborted, true);
  assert.equal(room.state.timers.size, 0);
  assert.deepEqual(room.state.trace.slice(-5), ['update:video_rooms', 'update:video_room_members', 'update:video_room_tokens', 'insert:video_room_events', 'legacy:delete']);
});

test('same host can safely retry after membership left without duplicate event or changed ended_at', async () => {
  const room = fixture();
  const first = await room.invoke();
  const endedAt = room.state.tables.video_rooms[0].ended_at;
  const second = await room.invoke();
  assert.equal(first.data.alreadyEnded, false);
  assert.equal(second.ok, true);
  assert.equal(second.data.alreadyEnded, true);
  assert.equal(second.data.cleanupComplete, true);
  assert.equal(room.state.tables.video_rooms[0].ended_at, endedAt);
  assert.equal(room.state.trace.filter((step) => step === 'update:video_rooms').length, 1);
  assert.equal(room.state.tables.video_room_events.length, 1);
  assert.equal(room.state.timers.size, 0);
});

test('only host can end or request idempotent cleanup; no member/relay side effects for guests', async () => {
  for (const ended of [false, true]) {
    const room = fixture({ actor: 'fixture-guest' });
    if (ended) room.state.tables.video_rooms[0].status = 'ended';
    const response = await room.invoke();
    assert.equal(response.ok, false);
    assert.equal(response.error.code, 'forbidden');
    assert.ok(room.state.trace.every((step) => step.startsWith('read:')));
    assert.equal(room.state.fetchCalls.length, 0);
  }
  const denied = fixture({ roleError: { message: 'fixture role lookup failed' } });
  assert.equal((await denied.invoke()).error.code, 'internal_error');
  assert.equal(denied.state.fetchCalls.length, 0);
});

test('failed terminal write is reported as failed, leaves room open, and runs no cleanup', async () => {
  const room = fixture({ failures: new Set(['update:video_rooms']) });
  const response = await room.invoke();
  assert.equal(response.ok, false);
  assert.equal(room.state.tables.video_rooms[0].status, 'open');
  assert.equal(room.state.fetchCalls.length, 0);
  assert.equal(room.state.tables.video_room_events.length, 0);
  assert.equal(room.state.trace.includes('update:video_room_members'), false);
});

test('every cleanup DB error is reported without concealing committed end or skipping later steps', async () => {
  const room = fixture({ failures: new Set(['update:video_room_members', 'update:video_room_tokens', 'insert:video_room_events']) });
  const response = await room.invoke();
  assert.equal(response.ok, true);
  assert.equal(response.data.ended, true);
  assert.equal(response.data.cleanupComplete, false);
  assert.deepEqual(response.data.cleanupWarnings, ['members_not_updated', 'tokens_not_revoked', 'room_event_not_recorded']);
  assert.equal(room.state.tables.video_rooms[0].status, 'ended');
  assert.equal(room.state.fetchCalls.length, 1);
  room.state.failures.clear();
  const retried = await room.invoke();
  assert.equal(retried.data.ended, true);
  assert.equal(retried.data.cleanupComplete, false, 'missing event remains honestly reported');
  assert.deepEqual(retried.data.cleanupWarnings, ['room_event_not_confirmed']);
  assert.ok(room.state.tables.video_room_members.every((member) => member.status === 'left'));
  assert.ok(room.state.tables.video_room_tokens.every((token) => token.revoked_at));
});

test('legacy HTTP/network failures are warnings; repeated already-deleted legacy room is harmless', async () => {
  for (const mode of [500, 401, 'network', 404]) {
    const room = fixture({ fetchMode: mode });
    const response = await room.invoke();
    assert.equal(response.ok, true);
    assert.equal(response.data.ended, true);
    assert.equal(response.data.cleanupComplete, mode === 404);
    assert.equal(room.state.timers.size, 0);
  }
});

test('concurrent end loses conditional update safely and cannot emit duplicate event', async () => {
  const room = fixture();
  room.state.beforePersist = () => {
    Object.assign(room.state.tables.video_rooms[0], { status: 'ended', ended_at: '2026-10-13T00:00:00Z' });
    room.state.tables.video_room_events.push({ id: 1, room_id: 3, type: 'room_ended' });
  };
  const response = await room.invoke();
  assert.equal(response.ok, true);
  assert.equal(response.data.alreadyEnded, true);
  assert.equal(room.state.tables.video_room_events.length, 1);
  assert.equal(room.state.tables.video_rooms[0].ended_at, '2026-10-13T00:00:00Z');
});

test('creator retry survives membership removal between room read and role lookup', async () => {
  const room = fixture();
  room.state.beforeRole = () => {
    Object.assign(room.state.tables.video_rooms[0], { status: 'ended', ended_at: '2026-10-13T00:00:00Z' });
    room.state.tables.video_room_members.forEach((member) => { member.status = 'left'; });
    room.state.tables.video_room_events.push({ id: 1, room_id: 3, type: 'room_ended' });
  };
  const response = await room.invoke();
  assert.equal(response.ok, true);
  assert.equal(response.data.alreadyEnded, true);
  assert.equal(room.state.tables.video_room_events.length, 1);
  assert.equal(room.state.trace.includes('update:video_rooms'), false);
});

test('inactive creator still cannot end an open room without host authorization', async () => {
  const room = fixture();
  room.state.tables.video_room_members[0].status = 'left';
  const response = await room.invoke();
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'forbidden');
  assert.equal(room.state.tables.video_rooms[0].status, 'open');
  assert.equal(room.state.fetchCalls.length, 0);
});

test('documented closed state finalizes safely; unknown state never falsely succeeds', async () => {
  const migration = fs.readFileSync(`${__dirname}/../../migrations/20260213100001_video_rooms_schema.sql`, 'utf8');
  assert.match(migration, /status TEXT NOT NULL DEFAULT 'open' CHECK \(status IN \('open', 'closed', 'ended'\)\)/);
  const closed = fixture();
  closed.state.tables.video_rooms[0].status = 'closed';
  assert.equal((await closed.invoke()).data.ended, true);
  assert.equal(closed.state.tables.video_rooms[0].status, 'ended');
  const unknown = fixture();
  unknown.state.tables.video_rooms[0].status = 'fixture-unknown';
  const response = await unknown.invoke();
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'conflict');
  assert.equal(unknown.state.tables.video_rooms[0].status, 'fixture-unknown');
  assert.equal(unknown.state.fetchCalls.length, 0);
  assert.ok(unknown.state.trace.every((step) => step.startsWith('read:')));
});

test('zero-row conditional update does not count as success if room is not ended', async () => {
  const room = fixture();
  room.state.beforePersist = () => { room.state.tables.video_rooms[0].status = 'closed'; };
  const response = await room.invoke();
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'internal_error');
  assert.equal(room.state.fetchCalls.length, 0);
  assert.equal(room.state.tables.video_room_events.length, 0);
});
