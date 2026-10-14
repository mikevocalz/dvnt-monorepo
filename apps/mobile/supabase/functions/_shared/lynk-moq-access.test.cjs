const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const path = require('node:path');

function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const moduleFixture = { exports: {} };
new Function('exports', 'module', transpile(path.join(__dirname, 'lynk-moq-access.ts')))(moduleFixture.exports, moduleFixture);
const { mintBoundedMoqAccess, moqAccessFailure } = moduleFixture.exports;
const standingFixture = { exports: {} };
new Function('exports', 'module', transpile(path.join(__dirname, 'creator-standing.ts')))(standingFixture.exports, standingFixture);
const NOW = Date.parse('2026-10-13T00:00:00Z');
const roomId = '00000000-0000-4000-8000-000000000001';
// Intentionally NOT a valid signed token. All issuer and DB operations are in-memory.
const fakeToken = (iat, exp) => `fixture.${Buffer.from(JSON.stringify({ iat, exp })).toString('base64url')}.not-a-signature`;
const scope = (extra = {}) => ({ role: 'participant', peerId: 'fixture-guest', path: `lynk/${roomId}/fixture-guest`, namespace: `lynk/${roomId}`, endsAt: null, ...extra });

test('signed-lifetime config is single purpose, bounded at 120s, with actual provider exp returned', async () => {
  for (const intent of ['publish', 'subscribe']) {
    let clock = NOW;
    let checks = 0;
    let requested;
    const access = scope({ path: intent === 'publish' ? `lynk/${roomId}/fixture-guest` : `lynk/${roomId}` });
    const token = fakeToken(NOW / 1000, NOW / 1000 + 120);
    const result = await mintBoundedMoqAccess({
      intent, now: () => clock, authorize: async () => { checks++; return { ok: true, access }; },
      mint: async (config) => { requested = config; clock += 5000; return { token, connection_url: 'https://fixture.invalid/relay' }; },
    });
    assert.deepEqual(requested, { [intent === 'publish' ? 'publishPath' : 'subscribePath']: access.path, ttl: 120 });
    assert.equal(checks, 2);
    assert.equal(result.ok, true);
    assert.equal(result.token, token, 'provider token is never altered or re-signed');
    assert.equal(result.expiresAt, new Date(NOW + 120_000).toISOString(), 'slow issuance does not invent an extra five seconds');
  }
});

test('room deadline bounds TTL; expired and invalid deadlines never mint', async () => {
  for (const seconds of [47, 0, -1, NaN]) {
    let mints = 0;
    const result = await mintBoundedMoqAccess({
      intent: 'publish', now: () => NOW,
      authorize: async () => ({ ok: true, access: scope({ endsAt: Number.isNaN(seconds) ? 'invalid' : new Date(NOW + seconds * 1000).toISOString() }) }),
      mint: async (config) => { mints++; assert.equal(config.ttl, 47); return { token: fakeToken(NOW / 1000, NOW / 1000 + config.ttl), connection_url: 'https://fixture.invalid' }; },
    });
    assert.equal(result.ok, seconds > 0);
    assert.equal(mints, seconds > 0 ? 1 : 0);
  }
});

test('host-ended race or revoked admission after mint never releases issued access', async () => {
  for (const code of ['conflict', 'forbidden', 'unauthorized']) {
    let checks = 0;
    const result = await mintBoundedMoqAccess({
      intent: 'publish', now: () => NOW,
      authorize: async () => ++checks === 1 ? { ok: true, access: scope() } : moqAccessFailure(code, 'fixture revoked'),
      mint: async () => ({ token: fakeToken(NOW / 1000, NOW / 1000 + 120), connection_url: 'https://fixture.invalid' }),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, code);
    assert.equal('token' in result, false);
  }
});

test('scope changes, shortened deadlines, expiry during mint, and unbounded provider expiry are rejected', async () => {
  for (const reason of ['scope', 'deadline', 'expired', 'unbounded', 'missing-exp']) {
    let checks = 0;
    const result = await mintBoundedMoqAccess({
      intent: 'publish', now: () => reason === 'expired' && checks > 1 ? NOW + 121_000 : NOW,
      authorize: async () => ({ ok: true, access: scope(++checks === 1 ? {} : reason === 'scope' ? { path: 'other-path' } : reason === 'deadline' ? { endsAt: new Date(NOW + 10_000).toISOString() } : {}) }),
      mint: async () => ({ token: reason === 'missing-exp' ? 'fixture.e30.not-a-signature' : fakeToken(NOW / 1000, NOW / 1000 + (reason === 'unbounded' ? 3600 : 120)), connection_url: 'https://fixture.invalid' }),
    });
    assert.equal(result.ok, false, reason);
    assert.equal('token' in result, false);
  }
});

function edgeFixture(overrides = {}) {
  const fixture = {
    room: { id: 1, uuid: roomId, status: 'open', is_public: true, created_by: 'fixture-host', ends_at: null },
    member: { room_id: 1, user_id: 'fixture-guest', status: 'active', role: 'participant', anon_label: null },
    userId: 'fixture-guest', session: null,
    invite: null, banned: false, creator: null, creatorError: null,
    memberError: null, forceMemberResult: false,
    admission: { state: 'allowed' },
    event: { ok: true, linked: false, endsAt: null },
    mints: 0, gates: 0, eventChecks: 0, queries: [], mutate: () => {}, ...overrides,
  };
  const db = {
    from(table) {
      const filters = [];
      const record = { table, filters };
      fixture.queries.push(record);
      const resolve = async () => {
        const row = table === 'video_rooms' ? fixture.room
          : table === 'video_room_members' ? fixture.member
          : table === 'creator_hosts' ? fixture.creator
          : table === 'video_room_invites' ? fixture.invite
          : assert.fail(`Unexpected table; live access forbidden: ${table}`);
        const error = table === 'creator_hosts' ? fixture.creatorError
          : table === 'video_room_members' ? fixture.memberError : null;
        const matches = row && (table === 'video_room_members' && fixture.forceMemberResult || filters.every(([key, value]) => row[key] === value));
        return { data: matches ? { ...row } : null, error };
      };
      const query = {
        select: () => query,
        eq: (key, value) => { filters.push([key, value]); return query; },
        single: resolve, maybeSingle: resolve,
      };
      return query;
    },
    rpc: async () => ({ data: fixture.banned, error: null }),
  };
  let handler;
  const requireFixture = (specifier) => {
    if (specifier.includes('supabase-js')) return { createClient: () => db };
    if (specifier.includes('verify-session')) return { verifySessionDetailed: async () => fixture.session ?? ({ ok: true, userId: fixture.userId }) };
    if (specifier.includes('verified-admission')) return {
      resolveVerifiedAdmission: async () => { fixture.gates++; return fixture.admission; },
      admissionRefusal: (value) => ({ message: 'fixture admission blocked', reason: value.reason }),
    };
    if (specifier.includes('event-access')) return { resolveEventRoomAccess: async () => { fixture.eventChecks++; return fixture.event; } };
    if (specifier.includes('creator-standing')) return standingFixture.exports;
    if (specifier.includes('lynk-moq-access')) return moduleFixture.exports;
    if (specifier.includes('zod')) return require('zod');
    if (specifier === 'npm:@fishjam-cloud/js-server-sdk@0.30.1') return {
      FishjamClient: class {
        async createMoqAccess(config) {
          fixture.mints++;
          fixture.request = config;
          fixture.mutate();
          const iat = Math.floor(Date.now() / 1000);
          return { token: fakeToken(iat, iat + config.ttl), connection_url: 'https://fixture.invalid/relay' };
        }
      },
    };
    throw new Error(`Unexpected import; live access forbidden: ${specifier}`);
  };
  new Function('exports', 'require', 'Deno', transpile(path.join(__dirname, '../lynk-moq-token/index.ts')))(
    {}, requireFixture, { env: { get: () => 'fixture-only' }, serve: (value) => { handler = value; } },
  );
  return { fixture, async invoke(body = { roomId, intent: 'publish' }) {
    const response = await handler(new Request('https://fixture.invalid/lynk-moq-token', {
      method: 'POST', headers: { Authorization: 'Bearer fixture-session', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }));
    return response.json();
  } };
}

test('actual edge handler repeats verified/event/private/ban/role gates after provider mint', async () => {
  const revocations = {
    ended: (f) => { f.room.status = 'ended'; },
    underage: (f) => { f.admission = { state: 'blocked', reason: 'underage' }; },
    ticket: (f) => { f.event = { ok: false, code: 'forbidden', message: 'fixture ticket revoked', detail: { reason: 'event_ticket_required' } }; },
    invite: (f) => { f.room.is_public = false; f.member = null; f.invite = null; },
    ban: (f) => { f.banned = true; },
    kick: (f) => { f.member.status = 'kicked'; },
    leave: (f) => { f.member.status = 'left'; },
    invited: (f) => { f.member.status = 'invited'; },
    memberDeleted: (f) => { f.member = null; },
    memberAccountChanged: (f) => { f.member.user_id = 'other-account'; },
    memberRoomChanged: (f) => { f.member.room_id = 2; },
    memberBanned: (f) => { f.member.status = 'banned'; },
    role: (f) => { f.member.role = 'moderator'; },
    anonymousPath: (f) => { f.member.anon_label = 'Anonymous 2'; },
  };
  for (const [name, revoke] of Object.entries(revocations)) {
    const { fixture, invoke } = edgeFixture();
    fixture.mutate = () => revoke(fixture);
    const response = await invoke();
    assert.equal(fixture.mints, 1, name);
    assert.equal(fixture.gates, 3, name);
    assert.equal(response.ok, false, name);
    assert.equal('data' in response, false, name);
  }
});

test('edge handler permits valid scoped access, denies ended/kicked rooms before mint, and preserves private invites', async () => {
  const good = edgeFixture();
  const response = await good.invoke();
  assert.equal(response.ok, true);
  assert.deepEqual(good.fixture.request, { publishPath: `lynk/${roomId}/fixture-guest`, ttl: 120 });
  assert.equal(response.data.peerId, 'fixture-guest');
  const claims = JSON.parse(Buffer.from(response.data.token.split('.')[1], 'base64url').toString());
  assert.equal(response.data.expiresAt, new Date(claims.exp * 1000).toISOString());
  for (const kind of ['missing', 'ended', 'kicked', 'private-uninvited']) {
    const denied = edgeFixture();
    if (kind === 'missing') denied.fixture.room = null;
    if (kind === 'ended') denied.fixture.room.status = 'ended';
    if (kind === 'kicked') denied.fixture.member.status = 'kicked';
    if (kind === 'private-uninvited') { denied.fixture.room.is_public = false; denied.fixture.member = null; }
    assert.equal((await denied.invoke()).ok, false, kind);
    assert.equal(denied.fixture.mints, 0, kind);
  }
  const invited = edgeFixture();
  invited.fixture.room.is_public = false;
  invited.fixture.member = null;
  invited.fixture.invite = { id: 1, room_id: 1, user_id: 'fixture-guest' };
  assert.equal((await invited.invoke()).error.detail.reason, 'room_join_required');
  assert.equal(invited.fixture.mints, 0);
  // Subscribe/spectator admission is intentionally unchanged by the publish fix.
  assert.equal((await invited.invoke({ roomId, intent: 'subscribe' })).ok, true);
});


test('verification denial precedes malformed token input without weakening adult validation', async () => {
  for (const reason of ['underage', 'verification_required']) {
    const blocked = edgeFixture({ admission: { state: 'blocked', reason } });
    const response = await blocked.invoke({ roomId: 1 });
    assert.equal(response.error.code, 'forbidden');
    assert.equal(response.error.detail.reason, reason);
    assert.equal(blocked.fixture.mints, 0);
  }
  const adult = edgeFixture();
  assert.equal((await adult.invoke({ roomId: 1 })).error.code, 'validation_error');
  assert.equal(adult.fixture.mints, 0);
});


test('publish requires active roster admission even for the creator and invited private guests', async () => {
  for (const host of [false, true]) {
    for (const status of [null, 'left', 'invited', 'kicked', 'banned', 'unknown']) {
      const denied = edgeFixture();
      if (host) denied.fixture.room.created_by = denied.fixture.userId;
      if (status === null) denied.fixture.member = null;
      else denied.fixture.member.status = status;
      const response = await denied.invoke({ roomId, intent: 'publish', isHost: true });
      assert.equal(response.ok, false, `${host ? 'creator' : 'guest'}:${status}`);
      assert.equal(response.error.code, 'forbidden');
      assert.equal(denied.fixture.mints, 0);
      assert.equal('data' in response, false);
    }
  }
});

test('active host, co-host, speaker and participant receive only their own signed publish path', async () => {
  for (const role of ['host', 'co-host', 'speaker', 'participant']) {
    const allowed = edgeFixture();
    allowed.fixture.member.role = role;
    const response = await allowed.invoke({ roomId, intent: 'publish', isHost: false, peerId: 'forged-peer' });
    assert.equal(response.ok, true, role);
    assert.equal(response.data.role, role);
    assert.equal(response.data.peerId, 'fixture-guest');
    assert.equal(response.data.path, `lynk/${roomId}/fixture-guest`);
    assert.deepEqual(allowed.fixture.request, { publishPath: response.data.path, ttl: 120 });
  }
  const creator = edgeFixture();
  creator.fixture.room.created_by = creator.fixture.userId;
  assert.equal((await creator.invoke()).data.role, 'host', 'creator role is server-derived');
  const viewer = edgeFixture();
  viewer.fixture.member.role = 'moderator';
  const response = await viewer.invoke({ roomId, intent: 'publish', isHost: true });
  assert.equal(response.error.detail.reason, 'publish_not_allowed', 'client host hint grants nothing');
  assert.equal(viewer.fixture.mints, 0);
  assert.equal((await viewer.invoke({ roomId, intent: 'subscribe' })).ok, true);
});

test('membership is scoped to the authenticated account and internal room, never client identity', async () => {
  for (const mismatch of ['user_id', 'room_id']) {
    for (const forceMemberResult of [false, true]) {
      const denied = edgeFixture({ forceMemberResult });
      denied.fixture.member[mismatch] = mismatch === 'user_id' ? 'other-account' : 2;
      const response = await denied.invoke({ roomId, intent: 'publish', userId: 'other-account', isHost: true });
      assert.equal(response.ok, false, `${mismatch}:${forceMemberResult}`);
      assert.equal(response.error.detail.reason, 'room_join_required');
      assert.equal(denied.fixture.mints, 0);
      const query = denied.fixture.queries.find((q) => q.table === 'video_room_members');
      assert.deepEqual(query.filters, [['room_id', 1], ['user_id', 'fixture-guest']]);
    }
  }
});

test('subscription keeps its existing eligibility boundary and never gains publish authority', async () => {
  for (const status of [null, 'left', 'invited', 'active']) {
    const viewer = edgeFixture();
    if (status === null) viewer.fixture.member = null;
    else viewer.fixture.member.status = status;
    const response = await viewer.invoke({ roomId, intent: 'subscribe', isHost: true });
    assert.equal(response.ok, true, String(status));
    assert.deepEqual(viewer.fixture.request, { subscribePath: `lynk/${roomId}`, ttl: 120 });
    assert.equal(response.data.role, 'participant');
  }
  const leftDuringMint = edgeFixture();
  leftDuringMint.fixture.mutate = () => { leftDuringMint.fixture.member.status = 'left'; };
  assert.equal((await leftDuringMint.invoke({ roomId, intent: 'subscribe' })).ok, false);
});

test('private and ticket restrictions still apply before mint for both intents', async () => {
  for (const intent of ['publish', 'subscribe']) {
    const privateRoom = edgeFixture();
    privateRoom.fixture.room.is_public = false;
    privateRoom.fixture.member = null;
    assert.equal((await privateRoom.invoke({ roomId, intent })).error.detail.reason, 'invite_only');
    assert.equal(privateRoom.fixture.mints, 0);
    const ticketed = edgeFixture({ event: { ok: false, code: 'forbidden', message: 'Ticket required', detail: { reason: 'event_ticket_required' } } });
    assert.equal((await ticketed.invoke({ roomId, intent })).error.detail.reason, 'event_ticket_required');
    assert.equal(ticketed.fixture.mints, 0);
    const allowed = edgeFixture({ event: { ok: true, linked: true, endsAt: null } });
    allowed.fixture.room.is_public = false;
    assert.equal((await allowed.invoke({ roomId, intent })).ok, true, 'approved event access preserves linked private-room access');
  }
});

test('app-only platform gate mirrors join, runs before roster checks, and repeats after mint', async () => {
  for (const intent of ['publish', 'subscribe']) {
    for (const platform of ['web', 'ios', 'android', 'unknown', undefined]) {
      const room = edgeFixture();
      room.fixture.room.app_only = true;
      const response = await room.invoke({ roomId, intent, ...(platform === undefined ? {} : { platform }) });
      assert.equal(response.ok, platform !== 'web', `${intent}:${platform}`);
      assert.equal(room.fixture.mints, platform === 'web' ? 0 : 1);
      if (platform === 'web') {
        assert.equal(response.error.detail.reason, 'ROOM_APP_ONLY');
        assert.equal(room.fixture.eventChecks, 0);
        assert.equal(room.fixture.queries.some((q) => q.table === 'video_room_members'), false);
      }
    }
    const changed = edgeFixture();
    changed.fixture.mutate = () => { changed.fixture.room.app_only = true; };
    const response = await changed.invoke({ roomId, intent, platform: 'web' });
    assert.equal(response.error.detail.reason, 'ROOM_APP_ONLY');
    assert.equal(changed.fixture.mints, 1);
    assert.equal('data' in response, false);
  }
  for (const platform of [null, 1, 'w'.repeat(33)]) {
    const invalid = edgeFixture();
    assert.equal((await invalid.invoke({ roomId, intent: 'publish', platform })).error.code, 'validation_error');
    assert.equal(invalid.fixture.mints, 0);
  }
  const call = edgeFixture();
  call.fixture.room.app_only = true;
  call.fixture.room.room_kind = 'call';
  assert.equal((await call.invoke({ roomId, intent: 'publish', platform: 'web' })).ok, true, 'matches join call exemption');
});

test('creator standing mirrors join for hosts/co-hosts, including suspension during mint', async () => {
  for (const intent of ['publish', 'subscribe']) {
    for (const role of ['creator', 'host', 'co-host', 'participant']) {
      for (const status of ['suspended', 'paused', 'rejected']) {
        const room = edgeFixture({ creator: { user_id: 'fixture-guest', status } });
        if (role === 'creator') room.fixture.room.created_by = room.fixture.userId;
        else room.fixture.member.role = role;
        const response = await room.invoke({ roomId, intent });
        assert.equal(response.ok, role === 'participant', `${intent}:${role}:${status}`);
        assert.equal(room.fixture.mints, role === 'participant' ? 1 : 0);
        if (role !== 'participant') {
          assert.equal(response.error.detail.code, 'creator_hosting_closed');
          assert.equal(response.error.detail.reason, status);
        }
      }
    }
    const changed = edgeFixture();
    changed.fixture.member.role = 'co-host';
    changed.fixture.mutate = () => { changed.fixture.creator = { user_id: changed.fixture.userId, status: 'suspended' }; };
    const response = await changed.invoke({ roomId, intent });
    assert.equal(response.error.detail.code, 'creator_hosting_closed');
    assert.equal(changed.fixture.mints, 1);
    assert.equal('data' in response, false);
  }
});

test('host and co-host membership loss during mint never releases a publish credential', async () => {
  for (const role of ['creator', 'host', 'co-host']) {
    for (const status of [null, 'left', 'invited', 'kicked', 'banned']) {
      const room = edgeFixture();
      if (role === 'creator') room.fixture.room.created_by = room.fixture.userId;
      else room.fixture.member.role = role;
      room.fixture.mutate = () => {
        if (status === null) room.fixture.member = null;
        else room.fixture.member.status = status;
      };
      const response = await room.invoke();
      assert.equal(response.ok, false, `${role}:${status}`);
      assert.equal(room.fixture.mints, 1);
      assert.equal('data' in response, false);
    }
  }
});

test('invalid sessions and database lookup failures cannot obtain publish authority', async () => {
  for (const reason of ['missing', 'expired', 'invalid']) {
    const room = edgeFixture({ session: { ok: false, reason } });
    assert.equal((await room.invoke()).error.code, 'unauthorized');
    assert.equal(room.fixture.gates, 0);
    assert.equal(room.fixture.mints, 0);
  }
  const member = edgeFixture({ memberError: { message: 'fixture membership lookup failed' } });
  assert.equal((await member.invoke()).error.code, 'internal_error');
  assert.equal(member.fixture.mints, 0);
  const creator = edgeFixture({ creatorError: { message: 'fixture standing lookup failed' } });
  creator.fixture.member.role = 'host';
  assert.equal((await creator.invoke()).error.detail.reason, 'standing_unavailable');
  assert.equal(creator.fixture.mints, 0);
});
