// Real cohost HTTP handler and linked-event policy. Database/media boundaries
// are synthetic; the atomic allocator is independently exercised in SQL tests.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const access = {};
vm.runInNewContext(compile(path.join(__dirname, '../_shared/event-access.ts')), { exports: access, Date, Promise, Error });
function fixture({ ticket = 'active', category = 'admission', state = 'live', ticketed = true,
  invited = false, staff, linked = true, signedIn = true, eventStatus = 'active', admission = 'allowed', full = false, failTable } = {}) {
  const at = hours => new Date(Date.now() + hours * 3_600_000).toISOString();
  const tables = {
    lynk_cohost_invites: [{ id: 3, room_id: 7, inviter_id: 'owner', invitee_id: 'guest', status: 'pending' }],
    video_rooms: [{ id: 7, uuid: '00000000-0000-4000-8000-000000000007', status: 'open', room_kind: 'lynk', created_at: at(-48), ends_at: linked ? at(-47.9) : at(1) }],
    events: linked ? [{ id: 9, lynk_room_id: '00000000-0000-4000-8000-000000000007', host_id: 'owner', status: eventStatus,
      visibility: 'private', ticketing_enabled: ticketed, start_date: at(-0.01), end_date: at(2) }] : [],
    event_lynk_lifecycle: [{ event_id: 9, state }],
    tickets: ticket ? [{ event_id: 9, user_id: 'guest', status: ticket, category }] : [],
    event_co_organizers: staff ? [{ id: 2, event_id: 9, user_id: 'guest', ...staff }] : [],
    event_invites: invited ? [{ event_id: 9, invited_user_id: 'guest', status: 'pending' }] : [],
    video_room_members: [], video_room_events: [], users: [], push_tokens: [],
  };
  const allocations = [];
  const db = {
    rpc: async (name, args) => {
      assert.equal(name, 'lynk_accept_cohost_atomic'); allocations.push(args);
      if (full) return { data: { ok: false, reason: 'room_full' } };
      tables.lynk_cohost_invites[0].status = 'accepted';
      tables.video_room_members.push({ room_id: 7, user_id: 'guest', role: 'co-host', status: 'active' });
      return { data: { ok: true } };
    },
    from: table => {
      const filters = []; let op;
      const run = () => {
        if (failTable === table) return { data: null, error: { message: 'unavailable' } };
        let rows = (tables[table] || []).filter(row => filters.every(f => f(row)));
        if (op?.kind === 'update') rows.forEach(row => Object.assign(row, op.value));
        if (op?.kind === 'insert') { rows = [op.value]; (tables[table] ??= []).push(op.value); }
        return { data: rows, error: null };
      };
      const one = async () => { const result = run(); return { ...result, data: result.data?.[0] ?? null }; };
      const q = { select: () => q, limit: () => q,
        eq: (k, value) => { filters.push(row => row[k] === value); return q; },
        in: (k, values) => { filters.push(row => values.includes(row[k])); return q; },
        update: value => { op = { kind: 'update', value }; return q; },
        insert: value => { op = { kind: 'insert', value }; return q; },
        single: one, maybeSingle: one, then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject) };
      return q;
    },
  };
  let handler;
  vm.runInNewContext(compile(path.join(__dirname, 'index.ts')), {
    exports: {}, Date, Error, Response, console: { log() {}, warn() {}, error() {} },
    Deno: { env: { get: () => 'fixture' }, serve: fn => { handler = fn; } },
    require: name => {
      if (name.includes('supabase-js')) return { createClient: () => db };
      if (name.includes('verify-session')) return { verifySessionDetailed: async () => signedIn ? { ok: true, userId: 'guest' } : { ok: false } };
      if (name.includes('verified-admission')) return { resolveVerifiedAdmission: async () => ({ state: admission }), admissionRefusal: () => ({ message: 'Verification required' }) };
      if (name.includes('creator-standing')) return { resolveCreatorStanding: async () => ({ state: 'allowed' }) };
      if (name.includes('event-access')) return access;
      return {};
    },
  });
  return { tables, allocations, run: async (action = 'accept') => (await handler(new Request('http://fixture', {
    method: 'POST', body: JSON.stringify({ action, inviteId: 3 }),
  }))).json() };
}
function staysPending(h) {
  assert.equal(h.allocations.length, 0);
  assert.equal(h.tables.video_room_members.length, 0);
  assert.equal(h.tables.lynk_cohost_invites[0].status, 'pending');
}

test('a room cohost invite cannot grant or replace linked paid-event admission', async () => {
  for (const opts of [{ ticket: null }, { ticket: 'refunded' }, { ticket: 'cancelled' }, { category: 'service' },
    { ticket: null, invited: true }, { ticket: null, staff: { role: 'editor', accepted: false } }]) {
    const h = fixture(opts); const result = await h.run();
    assert.equal(result.error.code, 'forbidden'); assert.match(result.error.message, /admission ticket/); staysPending(h);
  }
});

test('eligible room cohost waits until the event host starts; accepted event hosts keep pre-start access', async () => {
  const waiting = fixture({ state: 'scheduled' });
  assert.match((await waiting.run()).error.message, /Waiting for the host/); staysPending(waiting);
  for (const role of ['admin', 'editor']) {
    const eventHost = fixture({ ticket: null, state: 'scheduled', staff: { role, accepted: true } });
    assert.equal((await eventHost.run()).ok, true);
    assert.equal(eventHost.tables.lynk_cohost_invites[0].status, 'accepted');
  }
});

test('active/scanned paid tickets and invited free-event members can accept into live events', async () => {
  for (const opts of [{ ticket: 'active' }, { ticket: 'scanned' }, { ticketed: false, ticket: null, invited: true }, { linked: false, ticket: null }]) {
    const h = fixture(opts); const result = await h.run();
    assert.equal(result.ok, true); assert.equal(result.data.roomId, h.tables.video_rooms[0].uuid);
    assert.equal(h.tables.video_room_members[0].role, 'co-host');
  }
  const free = fixture({ ticketed: false, ticket: null });
  assert.match((await free.run()).error.message, /invitation/); staysPending(free);
});

test('terminal events, access read failures and failed verification grant no cohost authority', async () => {
  for (const opts of [{ eventStatus: 'cancelled' }, { state: 'ended' }, { failTable: 'tickets' }, { admission: 'blocked' }, { signedIn: false }]) {
    const h = fixture(opts); assert.equal((await h.run()).ok, false); staysPending(h);
  }
  const full = fixture({ full: true }); assert.match((await full.run()).error.message, /full/);
  assert.equal(full.tables.video_room_members.length, 0);
  assert.equal(full.tables.lynk_cohost_invites[0].status, 'pending');
});

test('declining does not require an event ticket and never allocates membership', async () => {
  const h = fixture({ ticket: null, state: 'scheduled' });
  assert.equal((await h.run('decline')).ok, true);
  assert.equal(h.tables.lynk_cohost_invites[0].status, 'declined');
  assert.equal(h.allocations.length, 0);
});
