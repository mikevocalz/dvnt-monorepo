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
    member: { status: 'active', role: 'participant', anon_label: null },
    invite: null, banned: false,
    admission: { state: 'allowed' },
    event: { ok: true, linked: false, endsAt: null },
    mints: 0, gates: 0, mutate: () => {}, ...overrides,
  };
  const db = {
    from(table) {
      const query = {
        select: () => query, eq: () => query,
        single: async () => ({ data: fixture.room && { ...fixture.room }, error: null }),
        maybeSingle: async () => ({ data: table === 'video_rooms' ? fixture.room && { ...fixture.room } : table === 'video_room_members' ? fixture.member && { ...fixture.member } : fixture.invite, error: null }),
      };
      return query;
    },
    rpc: async () => ({ data: fixture.banned, error: null }),
  };
  let handler;
  const requireFixture = (specifier) => {
    if (specifier.includes('supabase-js')) return { createClient: () => db };
    if (specifier.includes('verify-session')) return { verifySessionDetailed: async () => ({ ok: true, userId: 'fixture-guest' }) };
    if (specifier.includes('verified-admission')) return {
      resolveVerifiedAdmission: async () => { fixture.gates++; return fixture.admission; },
      admissionRefusal: (value) => ({ message: 'fixture admission blocked', reason: value.reason }),
    };
    if (specifier.includes('event-access')) return { resolveEventRoomAccess: async () => fixture.event };
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
  return { fixture, async invoke() {
    const response = await handler(new Request('https://fixture.invalid/lynk-moq-token', {
      method: 'POST', headers: { Authorization: 'Bearer fixture-session', 'Content-Type': 'application/json' },
      body: JSON.stringify({ roomId, intent: 'publish' }),
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
    role: (f) => { f.member.role = 'moderator'; },
    anonymousPath: (f) => { f.member.anon_label = 'Anonymous 2'; },
  };
  for (const [name, revoke] of Object.entries(revocations)) {
    const { fixture, invoke } = edgeFixture();
    fixture.mutate = () => revoke(fixture);
    const response = await invoke();
    assert.equal(fixture.mints, 1, name);
    assert.equal(fixture.gates, 2, name);
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
  invited.fixture.invite = { id: 1 };
  assert.equal((await invited.invoke()).ok, true);
});
