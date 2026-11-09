// Real lifecycle SQL + production start helper in isolated PostgreSQL-WASM.
// This is not a live migration, media call, or multi-session stress test.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const root = path.resolve(__dirname, '..');
const migration = name => fs.readFileSync(path.join(root, 'apps/mobile/supabase/migrations', name), 'utf8');
const source = migration('20261107151000_event_lynk_terminal_start.sql');
const startModule = { exports: {} };
new Function('exports', ts.transpileModule(fs.readFileSync(path.join(root,
  'apps/mobile/supabase/functions/_shared/event-lynk-start.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText)(startModule.exports);
const HOUR = 60 * 60 * 1000;

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE video_rooms (
      id serial PRIMARY KEY, uuid uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
      room_kind text DEFAULT 'lynk', status text DEFAULT 'open', created_by text DEFAULT 'host',
      is_public boolean DEFAULT false, created_at timestamptz DEFAULT now(), ends_at timestamptz
    );
    CREATE TABLE events (id serial PRIMARY KEY, lynk_room_id uuid, host_id text DEFAULT 'host',
      status text DEFAULT 'active', start_date timestamptz, end_date timestamptz);
    CREATE TABLE event_co_organizers (event_id integer, user_id text, role text, accepted boolean);
  `);
  await db.exec(migration('20261002210000_event_lynk_lifecycle.sql'));
  await db.exec(source);
  await db.exec(source); // Source migration is safe to install twice.
  const at = hours => new Date(Date.now() + hours * HOUR).toISOString();
  const addRoom = async (overrides = {}) => {
    const r = { status: 'open', created_by: 'host', is_public: false,
      created_at: at(-48), ends_at: at(-48 + 5 / 60), ...overrides };
    return (await db.query(`INSERT INTO video_rooms(status,created_by,is_public,created_at,ends_at)
      VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [r.status,r.created_by,r.is_public,r.created_at,r.ends_at])).rows[0];
  };
  const add = async (event = {}, room = {}) => {
    const r = await addRoom(room);
    const e = { host_id: 'host', status: 'active', start_date: at(2), end_date: at(5), ...event };
    return (await db.query(`INSERT INTO events(lynk_room_id,host_id,status,start_date,end_date)
      VALUES($1,$2,$3,$4,$5) RETURNING *`, [r.uuid,e.host_id,e.status,e.start_date,e.end_date])).rows[0];
  };
  const sync = async id => (await db.query('SELECT sync_event_lynk_lifecycle($1) AS result', [id])).rows[0].result;
  const state = async id => (await db.query('SELECT * FROM event_lynk_lifecycle WHERE event_id=$1', [id])).rows[0];
  const client = { rpc: async (name, args) => {
    assert.equal(name, 'start_event_lynk_atomic');
    try { return { data: (await db.query('SELECT start_event_lynk_atomic($1,$2,$3) AS result',
      [args.p_event_id,args.p_actor,args.p_room_uuid])).rows[0].result }; }
    catch (error) { return { error }; }
  } };
  const start = (event, actor = 'host') => startModule.exports.startEventLynk(client, event, actor);
  return { db, at, add, addRoom, sync, state, start };
}

test('scheduled rooms start once, survive ordinary rescheduling and retain plan deadlines', async () => {
  const h = await fixture();
  try {
    const e = await h.add();
    assert.equal((await h.sync(e.id)).state, 'scheduled');
    await h.db.query('UPDATE events SET start_date=$2,end_date=$3 WHERE id=$1', [e.id,h.at(3),h.at(6)]);
    assert.equal((await h.sync(e.id)).state, 'scheduled', 'postponement does not open the room');
    await h.db.query("INSERT INTO event_lynk_waiting(event_id,user_id) VALUES($1,'guest')", [e.id]);
    assert.deepEqual(await h.start(e), { ok: true, started: true, admitted: 1 });
    const first = await h.state(e.id);
    assert.equal(first.state, 'live');
    assert.equal(first.started_by, 'host');
    assert.deepEqual(await h.start(e), { ok: true, started: false, admitted: 0 });
    assert.equal((await h.state(e.id)).live_at.getTime(), first.live_at.getTime(), 'repeated start preserves start time');
    assert.equal((await h.sync(e.id)).state, 'live', 'cron never restarts a live room');
    assert.ok(first.scheduled_end.getTime() - first.scheduled_start.getTime() <= 5 * 60 * 1000 + 10,
      'original creation-time deadline becomes the five-minute scheduled plan');

    const longer = await h.add({ start_date: h.at(-7), end_date: null },
      { created_at: h.at(-48), ends_at: h.at(-36) });
    assert.equal((await h.start(longer)).ok, true, 'no-end event keeps longer plan window, matching admission');
    const expired = await h.add({ start_date: h.at(-7), end_date: null });
    assert.equal((await h.start(expired)).ok, false, 'expired six-hour default remains closed');
  } finally { await h.db.close(); }
});

test('real sync and start cannot revive a terminal same-room lifecycle or manual room end', async () => {
  const h = await fixture();
  try {
    for (const terminal of ['ended','cancelled']) {
      const e = await h.add();
      await h.sync(e.id);
      await h.db.query("UPDATE event_lynk_lifecycle SET state=$2,ended_at=now() WHERE event_id=$1", [e.id,terminal]);
      const before = await h.state(e.id);
      await h.db.query('UPDATE events SET start_date=$2,end_date=$3 WHERE id=$1', [e.id,h.at(4),h.at(8)]);
      assert.equal((await h.sync(e.id)).state, terminal, 'real historical sync used to reset this to scheduled');
      const result = await h.start(e);
      assert.equal(result.ok, false);
      assert.equal(result.state, terminal);
      assert.equal((await h.state(e.id)).ended_at.getTime(), before.ended_at.getTime());
      assert.equal((await h.db.query('SELECT status FROM video_rooms WHERE uuid=$1', [e.lynk_room_id])).rows[0].status,
        'open', 'lifecycle sync never rewrites or revives a room');
    }
    const manual = await h.add();
    await h.start(manual);
    await h.db.query("UPDATE video_rooms SET status='ended' WHERE uuid=$1", [manual.lynk_room_id]);
    assert.equal((await h.start(manual)).reason, 'room_ended');
    assert.equal((await h.state(manual.id)).state, 'ended');

    const cancelled = await h.add({ status: 'cancelled' });
    assert.equal((await h.start(cancelled)).reason, 'event_unavailable');
    await h.db.query("UPDATE events SET status='active' WHERE id=$1", [cancelled.id]);
    assert.equal((await h.start(cancelled)).ok, false, 'undoing cancellation does not restart the same room');

    const freshRoom = await h.addRoom();
    await h.db.query('UPDATE events SET lynk_room_id=$2 WHERE id=$1', [cancelled.id,freshRoom.uuid]);
    assert.equal((await h.start(cancelled)).reason, 'event_link_changed',
      'stale start cannot open a different room after a concurrent relink');
    assert.equal((await h.sync(cancelled.id)).state, 'scheduled', 'a different prepared room may be scheduled');
    const reset = await h.state(cancelled.id);
    assert.equal(reset.live_at, null); assert.equal(reset.started_by, null); assert.equal(reset.ended_at, null);
    assert.equal((await h.start({ ...cancelled, lynk_room_id: freshRoom.uuid })).started, true,
      'fresh room still requires an explicit start');
  } finally { await h.db.close(); }
});

test('duplicate links, missing schedules, invalid private rooms and lost authority fail closed', async () => {
  const h = await fixture();
  try {
    const duplicate = await h.add();
    await h.db.query('INSERT INTO events(lynk_room_id,start_date,end_date) VALUES($1,$2,$3)',
      [duplicate.lynk_room_id,h.at(2),h.at(5)]);
    assert.equal((await h.sync(duplicate.id)).reason, 'event_link_ambiguous');
    assert.equal((await h.start(duplicate)).reason, 'event_link_ambiguous');
    assert.equal(await h.state(duplicate.id), undefined);
    const missing = await h.add({ start_date: null });
    assert.equal((await h.start(missing)).reason, 'event_schedule_missing');
    assert.equal(await h.state(missing.id), undefined);
    for (const room of [{ is_public: true }, { created_by: 'other' }, { status: 'ended' }]) {
      const bad = await h.add({},room);
      assert.equal((await h.start(bad)).ok, false);
    }
    for (const [role,accepted,allowed] of [['admin',true,true],['editor',true,true],['scanner',true,false],['editor',false,false]]) {
      const e = await h.add();
      await h.db.query('INSERT INTO event_co_organizers VALUES($1,$2,$3,$4)', [e.id,'staff',role,accepted]);
      assert.equal((await h.start(e,'staff')).ok, allowed, `${role}/${accepted}`);
      await h.db.query('DELETE FROM event_co_organizers WHERE event_id=$1', [e.id]);
      assert.equal((await h.start(e,'staff')).reason, 'not_host', 'previously read host authority cannot survive removal');
    }
    assert.equal((await h.start(await h.add(),'')).reason, 'not_host');
  } finally { await h.db.close(); }
});

test('transaction rollback, repeated starts and SQL lock/privilege contracts hold', async () => {
  const h = await fixture();
  try {
    const e = await h.add();
    await h.sync(e.id);
    await h.db.exec('BEGIN');
    assert.equal((await h.start(e)).started, true);
    await h.db.exec('ROLLBACK');
    assert.equal((await h.state(e.id)).state, 'scheduled', 'start and synchronization commit together');
    const results = await Promise.all([h.start(e),h.start(e),h.start(e)]);
    assert.equal(results.filter(r => r.started).length, 1, 'repeated callers have one start winner');
    // PGlite serializes one connection. Lock ordering is additionally asserted
    // from installed function definitions; this is not a two-session race test.
    const definitions = (await h.db.query(`SELECT proname, pg_get_functiondef(oid) AS definition
      FROM pg_proc WHERE proname IN ('sync_event_lynk_lifecycle','start_event_lynk_atomic')`)).rows;
    const sync = definitions.find(r => r.proname === 'sync_event_lynk_lifecycle').definition;
    assert.ok(sync.indexOf('FROM public.events WHERE id = p_event_id FOR UPDATE') <
      sync.indexOf('FROM public.video_rooms WHERE uuid = e.lynk_room_id FOR UPDATE'));
    assert.match(sync, /previous\.state IN \('ended', 'cancelled'\)/);
    const atomic = definitions.find(r => r.proname === 'start_event_lynk_atomic').definition;
    assert.match(atomic, /FROM public\.event_co_organizers[\s\S]*?FOR SHARE/);
    assert.ok(atomic.indexOf('sync_event_lynk_lifecycle(e.id)') < atomic.indexOf("SET state = 'live'"));
    for (const signature of ['sync_event_lynk_lifecycle(integer)','start_event_lynk_atomic(integer,text,uuid)']) {
      assert.deepEqual((await h.db.query(`SELECT has_function_privilege('anon',$1,'execute') AS anon,
        has_function_privilege('authenticated',$1,'execute') AS authenticated,
        has_function_privilege('service_role',$1,'execute') AS service`, [signature])).rows[0],
      { anon: false, authenticated: false, service: true });
    }
    // RPC absence or an ambiguous result must never fall back to direct writes.
    for (const result of [{ error: new Error('missing RPC') }, { data: null },
      { data: { ok: true } }, { data: { ok: false, reason: 'unknown', message: 'Unknown' } }]) {
      await assert.rejects(() => startModule.exports.startEventLynk({ rpc: async () => result },e,'host'));
    }
  } finally { await h.db.close(); }
});
