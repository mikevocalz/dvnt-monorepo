// Real SQL + production TypeScript policy against an isolated PostgreSQL-WASM
// database. No production credentials, media calls, or live data.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const migration = name => readFileSync(path.join(root, 'apps/mobile/supabase/migrations', name), 'utf8');
const policy = { exports: {} };
new Function('exports', ts.transpileModule(readFileSync(path.join(root,
  'apps/mobile/supabase/functions/_shared/event-access.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(policy.exports);
const HOUR = 60 * 60 * 1000;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE video_rooms (
      id serial PRIMARY KEY, uuid uuid NOT NULL DEFAULT gen_random_uuid(), room_kind text DEFAULT 'lynk',
      status text DEFAULT 'open', max_participants integer DEFAULT 2, participant_count integer DEFAULT 0,
      created_at timestamptz DEFAULT now(), ends_at timestamptz
    );
    CREATE TABLE events (id serial PRIMARY KEY, lynk_room_id uuid, host_id text,
      status text DEFAULT 'active', start_date timestamptz, end_date timestamptz);
    CREATE TABLE event_lynk_lifecycle (event_id integer, state text);
    CREATE TABLE video_room_members (
      id serial PRIMARY KEY, room_id integer, user_id text, role text DEFAULT 'participant', status text DEFAULT 'active',
      joined_at timestamptz DEFAULT now(), left_at timestamptz, hand_raised boolean DEFAULT false,
      is_anonymous boolean DEFAULT false, anon_label text, UNIQUE(room_id,user_id)
    );
    CREATE TABLE video_room_bans (room_id integer, user_id text, expires_at timestamptz);
    CREATE TABLE lynk_cohost_invites (id serial PRIMARY KEY, room_id integer, inviter_id text, invitee_id text,
      status text DEFAULT 'pending', responded_at timestamptz);
  `);
  await db.exec(migration('20261015031100_lynk_atomic_member_admission.sql'));
  if (!process.env.EVENT_LYNK_ADMISSION_BASELINE) {
    const fix = migration('20261107150000_event_lynk_atomic_admission_window.sql');
    await db.exec(fix);
    await db.exec(fix); // Idempotent installation.
  }
  await db.exec('BEGIN');
  const now = (await db.query('SELECT now() AS at')).rows[0].at.getTime();
  const at = hours => new Date(now + hours * HOUR).toISOString();
  const add = async (roomOverride = {}, eventOverride = {}, state = 'live') => {
    const room = { status: 'open', created_at: at(-48), ends_at: at(-48 + 5 / 60), ...roomOverride };
    const { rows: [r] } = await db.query('INSERT INTO video_rooms(status,created_at,ends_at) VALUES($1,$2,$3) RETURNING *',
      [room.status, room.created_at, room.ends_at]);
    let event = null;
    if (eventOverride !== null) {
      event = { host_id: 'host', status: 'active', start_date: at(-1 / 60), end_date: at(2), ...eventOverride };
      const { rows: [e] } = await db.query('INSERT INTO events(lynk_room_id,host_id,status,start_date,end_date) VALUES($1,$2,$3,$4,$5) RETURNING id',
        [r.uuid, event.host_id, event.status, event.start_date, event.end_date]);
      event.id = e.id;
      if (state) await db.query('INSERT INTO event_lynk_lifecycle VALUES($1,$2)', [e.id, state]);
    }
    return { id: r.id, uuid: r.uuid, room, event, state };
  };
  const admit = async (id, user, anonymous = false) => (await db.query(
    'SELECT lynk_admit_member_atomic($1,$2,$3) AS result', [id, user, anonymous],
  )).rows[0].result;
  return { db, now, at, add, admit };
}

test('scheduled event admission matches event access after the original room deadline, without reopening ended rooms', async () => {
  const h = await fixture();
  try {
    const cases = [
      ['created two days ahead, now at event start', {}, {}, 'live', true],
      ['host starts early', {}, { start_date: h.at(24), end_date: h.at(26) }, 'scheduled', true],
      ['free hosting window elapsed', {}, { start_date: h.at(-1) }, 'live', false],
      ['event ended before the plan window', { ends_at: h.at(-24) }, { end_date: h.at(-1 / 120) }, 'live', false],
      ['manual room end', { status: 'ended' }, {}, 'live', false],
      ['lifecycle ended', {}, {}, 'ended', false],
      ['lifecycle cancelled', {}, {}, 'cancelled', false],
      ['event cancelled', {}, { status: 'cancelled' }, 'live', false],
      ['event deleted', {}, { status: 'deleted' }, 'live', false],
      ['missing schedule', {}, { start_date: null }, 'live', false],
      ['no end date retains existing six-hour policy', {}, { start_date: h.at(-1), end_date: null }, 'live', true],
      ['no end date past six-hour window', {}, { start_date: h.at(-7), end_date: null }, 'live', false],
      ['room created after event start uses its own deadline', { created_at: h.at(-1), ends_at: h.at(-55 / 60) }, { start_date: h.at(-2) }, 'live', false],
      ['unlimited room still ends with its event', { ends_at: null }, { end_date: h.at(-1 / 60) }, 'live', false],
      ['ordinary explicit expired deadline', { created_at: h.at(-2), ends_at: h.at(-1) }, null, null, false],
      ['ordinary live deadline', { ends_at: h.at(1) }, null, null, true],
      ['ordinary unlimited room', { ends_at: null }, null, null, true],
    ];
    for (const [label, room, event, state, expected] of cases) {
      const row = await h.add(room, event, state);
      if (event !== null) {
        const decision = policy.exports.decideEventRoomAccess(row.event,
          { organizer: true, ticket: false, invited: false }, row.room, h.now, state === 'live', state);
        assert.equal(decision.ok, expected, `${label}: production TS policy`);
      }
      const got = await h.admit(row.id, 'host');
      assert.equal(got.ok, expected, `${label}: SQL admission ${JSON.stringify(got)}`);
      if (!expected) assert.equal(got.reason, 'room_ended', label);
      const stored = (await h.db.query('SELECT status, created_at, ends_at FROM video_rooms WHERE id=$1', [row.id])).rows[0];
      assert.equal(stored.status, row.room.status, `${label}: no reopened status`);
      assert.equal(stored.ends_at?.toISOString() ?? null, row.room.ends_at, `${label}: no deadline mutation`);
      assert.equal(stored.created_at?.toISOString() ?? null, row.room.created_at, `${label}: no duration inflation`);
    }
    const duplicate = await h.add();
    await h.db.query('INSERT INTO events(lynk_room_id,start_date,end_date) VALUES($1,$2,$3)', [duplicate.uuid, h.at(-1/60), h.at(2)]);
    assert.equal((await h.admit(duplicate.id, 'host')).ok, false, 'ambiguous event link fails closed');
  } finally { await h.db.close(); }
});

test('event host/cohost acceptance keeps capacity, bans, stable anonymous identity and service-only permissions', async () => {
  const h = await fixture();
  try {
    const row = await h.add();
    assert.equal((await h.admit(row.id, 'host')).ok, true);
    await h.db.query("UPDATE video_room_members SET role='host' WHERE room_id=$1 AND user_id='host'", [row.id]);
    const invite = (await h.db.query("INSERT INTO lynk_cohost_invites(room_id,inviter_id,invitee_id) VALUES($1,'host','cohost') RETURNING id", [row.id])).rows[0].id;
    const accepted = (await h.db.query("SELECT lynk_accept_cohost_atomic($1,'cohost') AS r", [invite])).rows[0].r;
    assert.equal(accepted.ok, true, 'event cohost may accept after original creation-time expiry');
    assert.equal(accepted.role, 'co-host');
    assert.equal((await h.admit(row.id, 'late')).reason, 'room_full', 'invite does not create extra capacity');
    assert.equal((await h.admit(row.id, 'cohost')).memberRole, 'co-host', 'rejoin keeps accepted role');
    await h.db.query("UPDATE event_lynk_lifecycle SET state='ended' WHERE event_id=$1", [row.event.id]);
    assert.equal((await h.admit(row.id, 'host')).reason, 'room_ended', 'active membership cannot revive ended lifecycle');

    const privacy = await h.add();
    const first = await h.admit(privacy.id, 'member', true);
    const again = await h.admit(privacy.id, 'member', false);
    assert.equal(first.isAnonymous, true);
    assert.equal(again.isAnonymous, true);
    assert.equal(again.anonLabel, first.anonLabel);
    assert.equal(again.current, 1);
    await h.db.query("INSERT INTO video_room_bans(room_id,user_id) VALUES($1,'banned')", [privacy.id]);
    assert.equal((await h.admit(privacy.id, 'banned')).reason, 'member_banned');
    for (const signature of ['lynk_admission_window_open(integer)', 'lynk_admit_member_atomic(integer,text,boolean)', 'lynk_accept_cohost_atomic(integer,text)']) {
      const p = (await h.db.query("SELECT has_function_privilege('anon',$1,'execute') AS anon, has_function_privilege('authenticated',$1,'execute') AS authenticated, has_function_privilege('service_role',$1,'execute') AS service", [signature])).rows[0];
      assert.deepEqual(p, { anon: false, authenticated: false, service: true }, signature);
    }
  } finally { await h.db.close(); }
});
