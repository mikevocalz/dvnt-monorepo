// Executes the actual legacy handler; all database and provider operations are
// synthetic. No credentials, rooms or media sessions are created externally.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const ROOM = '00000000-0000-4000-8000-000000000001';
const transpile = (file) => ts.transpileModule(fs.readFileSync(file, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const standing = { exports: {} };
new Function('exports', 'module', transpile(path.join(__dirname, '../_shared/creator-standing.ts')))(standing.exports, standing);

function fixture(overrides = {}) {
  const state = {
    room: { id: 1, uuid: ROOM, status: 'open', is_public: true, created_by: 'owner', ends_at: null },
    member: { room_id: 1, user_id: 'guest', role: 'speaker', status: 'active', anon_label: null, livestream_id: 'existing-stream' },
    invite: null, creator: null, publishers: [], banned: false,
    userId: 'guest', admission: { state: 'allowed' },
    event: { ok: true, linked: false, endsAt: null },
    queries: [], writes: [], creates: 0, mints: 0, viewerMints: 0, gates: 0,
    onCreate: () => {}, onMint: () => {}, onViewerMint: () => {}, ...overrides,
  };
  const db = {
    from(table) {
      const filters = [];
      let patch;
      let inserted;
      state.queries.push({ table, filters });
      const rows = () => table === 'video_rooms' ? [state.room]
        : table === 'video_room_members' ? [state.member, ...state.publishers]
        : table === 'video_room_invites' ? [state.invite]
        : table === 'creator_hosts' ? [state.creator]
        : assert.fail(`Unexpected table: ${table}`);
      const resolve = async (single = false) => {
        const error = state.errorTable === table ? { message: 'fixture read failed' } : null;
        let result = rows().filter(Boolean).filter((row) => filters.every((check) => check(row)));
        if (patch) {
          state.writes.push({ table, patch: { ...patch } });
          for (const row of result) Object.assign(row, patch);
        }
        if (inserted) {
          state.writes.push({ table, insert: { ...inserted } });
          state.member = { ...inserted };
          result = [state.member];
        }
        return { data: error ? null : single ? result[0] && { ...result[0] } : result.map((row) => ({ ...row })), error };
      };
      const query = {
        select: () => query,
        eq: (key, value) => { filters.push((row) => row[key] === value); return query; },
        not: (key, op, value) => { assert.equal(op, 'is'); filters.push((row) => row[key] !== value); return query; },
        in: (key, values) => { filters.push((row) => values.includes(row[key])); return query; },
        update: (value) => { patch = value; return query; },
        insert: (value) => { inserted = value; return query; },
        maybeSingle: () => resolve(true), single: () => resolve(true),
        then: (yes, no) => resolve().then(yes, no),
      };
      return query;
    },
    rpc: async () => ({ data: state.banned, error: state.banError ?? null }),
  };
  let handler;
  const req = (specifier) => {
    if (specifier.includes('supabase-js')) return { createClient: () => db };
    if (specifier.includes('verify-session')) return { verifySessionDetailed: async () => ({ ok: true, userId: state.userId }) };
    if (specifier.includes('verified-admission')) return {
      resolveVerifiedAdmission: async () => { state.gates++; return state.admission; },
      admissionRefusal: (value) => ({ message: 'fixture verification refused', reason: value.reason }),
    };
    if (specifier.includes('event-access')) return { resolveEventRoomAccess: async () => state.event };
    if (specifier.includes('creator-standing')) return standing.exports;
    if (specifier.includes('zod')) return require('zod');
    if (specifier === 'npm:@fishjam-cloud/js-server-sdk@0.30.0') return {
      FishjamClient: class {
        async createRoom(config) { assert.deepEqual(config, { roomType: 'livestream' }); state.creates++; state.onCreate(); return { id: 'new-stream' }; }
        async createLivestreamStreamerToken(id) { state.mints++; state.mintedId = id; state.onMint(); return { token: 'synthetic-streamer-token' }; }
        async createLivestreamViewerToken(id) { state.viewerMints++; state.onViewerMint(); return { token: `synthetic-viewer-${id}` }; }
      },
    };
    throw Error(`Unexpected import; live access forbidden: ${specifier}`);
  };
  new Function('exports', 'require', 'Deno', transpile(path.join(__dirname, 'index.ts')))(
    {}, req, { env: { get: () => 'fixture-only' }, serve: (fn) => { handler = fn; } },
  );
  return { state, async invoke(body = { roomId: ROOM, intent: 'publish' }) {
    return (await handler(new Request('https://fixture.invalid/token', {
      method: 'POST', headers: { Authorization: 'Bearer fixture-only', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }))).json();
  } };
}

const viewer = { room_id: 1, user_id: 'publisher', role: 'host', status: 'active', anon_label: null, livestream_id: 'other-stream' };

test('legacy publish requires active admission including creator and never inserts or reactivates membership', async () => {
  for (const creator of [false, true]) {
    for (const status of [null, 'left', 'invited', 'kicked', 'banned']) {
      const f = fixture();
      if (creator) f.state.room.created_by = f.state.userId;
      if (status === null) f.state.member = null;
      else f.state.member.status = status;
      const response = await f.invoke({ roomId: ROOM, intent: 'publish', isHost: true });
      assert.equal(response.ok, false, `${creator}:${status}`);
      assert.equal(response.error.code, 'forbidden');
      assert.equal(f.state.creates, 0);
      assert.equal(f.state.mints, 0);
      assert.deepEqual(f.state.writes, []);
    }
  }
});

test('legacy role permissions and authenticated identity remain server-owned', async () => {
  for (const role of ['host', 'co-host', 'speaker', 'participant', 'moderator']) {
    const f = fixture();
    f.state.member.role = role;
    const response = await f.invoke({ roomId: ROOM, intent: 'publish', isHost: true });
    assert.equal(response.ok, ['host', 'co-host', 'speaker'].includes(role), role);
    assert.deepEqual(f.state.writes, []);
    if (response.ok) assert.equal(response.data.role, role);
    else assert.equal(response.error.detail.reason, 'publish_not_allowed');
  }
  for (const field of ['user_id', 'room_id']) {
    const f = fixture();
    f.state.member[field] = field === 'user_id' ? 'different-account' : 2;
    assert.equal((await f.invoke()).error.detail.reason, 'room_join_required');
    assert.equal(f.state.mints, 0);
  }
  const creator = fixture();
  creator.state.room.created_by = creator.state.userId;
  creator.state.member.role = 'participant';
  assert.equal((await creator.invoke()).data.role, 'host');
});

test('provisioning writes only livestream metadata to an existing active member', async () => {
  const f = fixture();
  f.state.member.livestream_id = null;
  const response = await f.invoke();
  assert.equal(response.ok, true);
  assert.equal(f.state.creates, 1);
  assert.equal(f.state.mints, 1);
  assert.equal(response.data.livestreamId, 'new-stream');
  assert.deepEqual(f.state.writes, [{ table: 'video_room_members', patch: { livestream_id: 'new-stream' } }]);
  assert.equal(f.state.member.status, 'active');
  assert.equal(f.state.gates, 3);
});

test('leaving while provisioning cannot reactivate membership or mint a token', async () => {
  for (const status of [null, 'left', 'kicked', 'banned']) {
    const f = fixture();
    f.state.member.livestream_id = null;
    f.state.onCreate = () => {
      if (status === null) f.state.member = null;
      else f.state.member.status = status;
    };
    const response = await f.invoke();
    assert.equal(response.ok, false, String(status));
    assert.equal(f.state.creates, 1);
    assert.equal(f.state.mints, 0);
    assert.equal(f.state.member?.status ?? null, status);
    assert.equal(f.state.writes.some((write) => write.insert || 'status' in write.patch), false);
  }
});

test('legacy publish repeats room, membership, verified, ticket, ban and role checks after mint', async () => {
  const revocations = {
    ended: (s) => { s.room.status = 'ended'; },
    deletedRoom: (s) => { s.room = null; },
    left: (s) => { s.member.status = 'left'; },
    invited: (s) => { s.member.status = 'invited'; },
    kicked: (s) => { s.member.status = 'kicked'; },
    bannedMember: (s) => { s.member.status = 'banned'; },
    deletedMember: (s) => { s.member = null; },
    role: (s) => { s.member.role = 'participant'; },
    account: (s) => { s.member.user_id = 'other'; },
    ban: (s) => { s.banned = true; },
    verified: (s) => { s.admission = { state: 'blocked', reason: 'underage' }; },
    ticket: (s) => { s.event = { ok: false, code: 'forbidden', message: 'Ticket required' }; },
    deadline: (s) => { s.event.endsAt = '2000-01-01T00:00:00Z'; },
    private: (s) => { s.room.is_public = false; s.member = null; },
    stream: (s) => { s.member.livestream_id = 'changed-stream'; },
    peer: (s) => { s.member.anon_label = 'Anon 8'; },
  };
  for (const [name, revoke] of Object.entries(revocations)) {
    const f = fixture();
    f.state.onMint = () => revoke(f.state);
    const response = await f.invoke();
    assert.equal(response.ok, false, name);
    assert.equal(f.state.mints, 1, name);
    assert.equal('data' in response, false, name);
    assert.deepEqual(f.state.writes, []);
  }
});

test('legacy subscribe keeps nonmember eligibility while rechecking access after mint', async () => {
  const publicViewer = fixture({ member: null, publishers: [{ ...viewer }] });
  const allowed = await publicViewer.invoke({ roomId: ROOM, intent: 'subscribe' });
  assert.equal(allowed.ok, true);
  assert.equal(allowed.data.streams.length, 1);
  assert.equal(publicViewer.state.viewerMints, 1);
  assert.deepEqual(publicViewer.state.writes, []);
  for (const revoke of [(s) => { s.room.status = 'ended'; }, (s) => { s.member.status = 'left'; }, (s) => { s.banned = true; }]) {
    const f = fixture({ publishers: [{ ...viewer }] });
    f.state.member.role = 'participant';
    f.state.member.livestream_id = null;
    f.state.onViewerMint = () => revoke(f.state);
    assert.equal((await f.invoke({ roomId: ROOM, intent: 'subscribe' })).ok, false);
    assert.equal(f.state.viewerMints, 1);
  }
});

test('private invitations and event-ticket gates cannot create publish membership', async () => {
  const privateViewer = fixture({ member: null });
  privateViewer.state.room.is_public = false;
  assert.equal((await privateViewer.invoke()).error.detail.reason, 'invite_only');
  privateViewer.state.invite = { room_id: 1, user_id: 'guest', id: 3 };
  assert.equal((await privateViewer.invoke()).error.detail.reason, 'room_join_required');
  assert.equal((await privateViewer.invoke({ roomId: ROOM, intent: 'subscribe' })).ok, true);
  assert.deepEqual(privateViewer.state.writes, []);
  const ticket = fixture({ event: { ok: false, code: 'forbidden', message: 'Ticket required', detail: { reason: 'event_ticket_required' } } });
  assert.equal((await ticket.invoke()).error.detail.reason, 'event_ticket_required');
  assert.equal(ticket.state.mints, 0);
});

test('legacy app-only platform and creator-standing parity apply before and after mint', async () => {
  for (const platform of ['web', 'ios', 'android', undefined]) {
    const f = fixture();
    f.state.room.app_only = true;
    const response = await f.invoke({ roomId: ROOM, intent: 'publish', platform });
    assert.equal(response.ok, platform !== 'web');
    assert.equal(f.state.mints, platform === 'web' ? 0 : 1);
  }
  for (const duringMint of [false, true]) {
    const f = fixture();
    f.state.member.role = 'co-host';
    const suspend = () => { f.state.creator = { user_id: 'guest', status: 'suspended' }; };
    if (duringMint) f.state.onMint = suspend;
    else suspend();
    const response = await f.invoke();
    assert.equal(response.error.detail.code, 'creator_hosting_closed');
    assert.equal(f.state.mints, duringMint ? 1 : 0);
    assert.equal('data' in response, false);
    const web = fixture();
    if (duringMint) web.state.onMint = () => { web.state.room.app_only = true; };
    else web.state.room.app_only = true;
    assert.equal((await web.invoke({ roomId: ROOM, intent: 'publish', platform: 'web' })).error.detail.reason, 'ROOM_APP_ONLY');
  }
});

test('verification precedes malformed input and database read errors fail closed', async () => {
  const blocked = fixture({ admission: { state: 'blocked', reason: 'underage' } });
  assert.equal((await blocked.invoke({ roomId: 1 })).error.detail.reason, 'underage');
  const malformed = fixture();
  assert.equal((await malformed.invoke({ roomId: 1 })).error.code, 'validation_error');
  for (const table of ['video_rooms', 'video_room_members']) {
    const f = fixture({ errorTable: table });
    assert.equal((await f.invoke()).error.code, 'internal_error');
    assert.equal(f.state.creates, 0);
    assert.equal(f.state.mints, 0);
  }
});

test('legacy viewer results omit publishers revoked or changed during token mint', async () => {
  for (const revoke of [
    (s) => { s.publishers[0].status = 'left'; },
    (s) => { s.publishers[0].role = 'participant'; },
    (s) => { s.publishers[0].livestream_id = 'changed-stream'; },
    (s) => { s.publishers[0].anon_label = 'Anon 9'; },
  ]) {
    const f = fixture({ member: null, publishers: [{ ...viewer }] });
    f.state.onViewerMint = () => revoke(f.state);
    const response = await f.invoke({ roomId: ROOM, intent: 'subscribe' });
    assert.equal(response.ok, true);
    assert.deepEqual(response.data.streams, []);
    assert.equal(f.state.viewerMints, 1);
  }
  const invite = fixture({ member: null, publishers: [{ ...viewer }], invite: { room_id: 1, user_id: 'guest', id: 3 } });
  invite.state.room.is_public = false;
  invite.state.onViewerMint = () => { invite.state.invite = null; };
  assert.equal((await invite.invoke({ roomId: ROOM, intent: 'subscribe' })).error.detail.reason, 'invite_only');
});
