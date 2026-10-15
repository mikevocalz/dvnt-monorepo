// Isolated PostgreSQL-WASM fixture. No production credentials or live rooms.
// NODE_PATH=<directory with @electric-sql/pglite> node --test this-file
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');
const { PGlite } = require('@electric-sql/pglite');

const migration = readFileSync(resolve(
  __dirname, '../apps/mobile/supabase/migrations/20261015031100_lynk_atomic_member_admission.sql',
), 'utf8');

async function fixture() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon;
    CREATE ROLE authenticated;
    CREATE ROLE service_role BYPASSRLS;
    CREATE TABLE public.video_rooms (
      id serial PRIMARY KEY,
      uuid uuid NOT NULL DEFAULT gen_random_uuid(),
      room_kind text NOT NULL DEFAULT 'lynk',
      status varchar DEFAULT 'open',
      max_participants integer DEFAULT 12,
      participant_count integer DEFAULT 0,
      ends_at timestamptz
    );
    CREATE TABLE public.video_room_members (
      id serial PRIMARY KEY,
      room_id integer NOT NULL,
      user_id text NOT NULL,
      role varchar DEFAULT 'participant',
      status varchar DEFAULT 'active',
      joined_at timestamptz DEFAULT now(),
      left_at timestamptz,
      hand_raised boolean NOT NULL DEFAULT false,
      is_anonymous boolean NOT NULL DEFAULT false,
      anon_label text,
      UNIQUE (room_id, user_id)
    );
    CREATE TABLE public.video_room_bans (
      room_id integer NOT NULL,
      user_id text NOT NULL,
      expires_at timestamptz
    );
    CREATE TABLE public.lynk_cohost_invites (
      id serial PRIMARY KEY,
      room_id integer NOT NULL,
      inviter_id text NOT NULL,
      invitee_id text NOT NULL,
      status text NOT NULL DEFAULT 'pending',
      responded_at timestamptz
    );
    INSERT INTO public.video_rooms(id,max_participants) VALUES (7,2), (8,3);
    INSERT INTO public.video_rooms(id,room_kind) VALUES (9,'call');
    INSERT INTO public.video_rooms(id,ends_at) VALUES (10,now() - interval '1 hour');
  `);
  await db.exec(migration);
  await db.exec(migration); // Migration may be re-applied during rebuild/review.
  return db;
}

async function admit(db, roomId, userId, anonymous = false) {
  const { rows } = await db.query(
    'SELECT public.lynk_admit_member_atomic($1,$2,$3) AS admission',
    [roomId, userId, anonymous],
  );
  return rows[0].admission;
}

test('capacity is enforced; reconnects cannot steal another seat or identity', async () => {
  const db = await fixture();
  try {
    const alice = await admit(db, 7, 'alice', true);
    assert.equal(alice.ok, true);
    assert.equal(alice.anonLabel, 'Anon 1');
    assert.equal(alice.current, 1);

    const bob = await admit(db, 7, 'bob', true);
    assert.equal(bob.anonLabel, 'Anon 2');
    assert.equal(bob.current, 2);

    assert.deepEqual(await admit(db, 7, 'charlie', true), {
      ok: false, reason: 'room_full', current: 2, max: 2,
    });

    // A user changing their pre-join toggle or reconnecting on another device
    // must not accidentally disclose their authenticated profile.
    const reconnect = await admit(db, 7, 'alice', false);
    assert.equal(reconnect.ok, true);
    assert.equal(reconnect.isAnonymous, true);
    assert.equal(reconnect.anonLabel, 'Anon 1');
    assert.equal(reconnect.current, 2);
    const members = (await db.query(
      'SELECT user_id, anon_label, is_anonymous FROM public.video_room_members WHERE room_id=7 ORDER BY id',
    )).rows;
    assert.equal(members.length, 2);
    assert.deepEqual(members.map(m => m.anon_label), ['Anon 1', 'Anon 2']);
  } finally { await db.close(); }
});

test('aliases are monotonic, room-local, and stable across leave/rejoin', async () => {
  const db = await fixture();
  try {
    await admit(db, 7, 'alice', true);
    await db.exec(`UPDATE public.video_room_members SET status='left' WHERE user_id='alice';`);
    const bob = await admit(db, 7, 'bob', true);
    assert.equal(bob.anonLabel, 'Anon 2', 'leaving must not recycle Anon 1');
    const alice = await admit(db, 7, 'alice', true);
    assert.equal(alice.anonLabel, 'Anon 1', 'returning member keeps their handle');
    assert.equal((await admit(db, 7, 'charlie', true)).reason, 'room_full');
    const differentRoom = await admit(db, 8, 'charlie', true);
    assert.equal(differentRoom.anonLabel, 'Anon 1', 'labels are room-local');
    const [{ participant_count }] = (await db.query('SELECT participant_count FROM public.video_rooms WHERE id=7')).rows;
    assert.equal(participant_count, 2);
  } finally { await db.close(); }
});

test('existing duplicate labels are repaired on rejoin without exposing auth IDs', async () => {
  const db = await fixture();
  try {
    await db.exec(`
      INSERT INTO public.video_room_members(room_id,user_id,anon_label,is_anonymous)
        VALUES (8,'old-a','Anon 1',true),(8,'old-b','Anon 1',true);
    `);
    const old = await admit(db, 8, 'old-b', true);
    assert.equal(old.anonLabel, 'Anon 2');
    await db.exec(`UPDATE public.video_room_members SET status='left' WHERE room_id=8 AND user_id='old-a';`);
    const next = await admit(db, 8, 'new', true);
    assert.equal(next.anonLabel, 'Anon 3');
    assert.equal((await db.query(`
      SELECT count(distinct anon_label)::integer AS unique_labels FROM public.video_room_members
      WHERE room_id=8 AND is_anonymous
    `)).rows[0].unique_labels, 3);
  } finally { await db.close(); }
});

test('ban, room end, invalid input and call-room boundaries fail closed', async () => {
  const db = await fixture();
  try {
    await db.exec(`INSERT INTO public.video_room_bans VALUES (7,'banned',null);`);
    assert.equal((await admit(db,7,'banned')).reason, 'member_banned');
    assert.equal((await admit(db,9,'caller')).reason, 'room_not_found');
    assert.equal((await admit(db,10,'late')).reason, 'room_ended');
    assert.equal((await admit(db,7,'')).reason, 'invalid_input');
    assert.equal((await admit(db,999,'nobody')).reason, 'room_not_found');
    assert.equal((await db.query('SELECT count(*)::integer AS n FROM video_room_members')).rows[0].n, 0);
  } finally { await db.close(); }
});

test('RPC is not executable by the browser roles', async () => {
  const db = await fixture();
  try {
    await db.exec('SET ROLE authenticated');
    await assert.rejects(admit(db,7,'bypass',true), /permission denied/);
    await db.exec('RESET ROLE');
    await db.exec('SET ROLE anon');
    await assert.rejects(admit(db,7,'bypass',true), /permission denied/);
  } finally {
    await db.exec('RESET ROLE');
    await db.close();
  }
});

test('cohost acceptance reserves capacity, marks invitation once, and cannot resurrect kicked users', async () => {
  const db = await fixture();
  try {
    await db.exec(`
      INSERT INTO public.lynk_cohost_invites(room_id,inviter_id,invitee_id)
        VALUES (7,'host','cohost'),(7,'host','late'),(8,'host','banned');
      INSERT INTO public.video_room_members(room_id,user_id,role)
        VALUES (7,'host','host'),(8,'host','host');
    `);
    const accept = async (inviteId, identity) => (await db.query(
      'SELECT public.lynk_accept_cohost_atomic($1,$2) AS result',
      [inviteId, identity],
    )).rows[0].result;
    assert.equal((await accept(1,'stranger')).reason, 'invite_not_found');
    const invited = await accept(1,'cohost');
    assert.equal(invited.ok,true);
    assert.equal(invited.role,'co-host');
    assert.equal((await db.query(
      "SELECT role FROM video_room_members WHERE user_id='cohost'",
    )).rows[0].role,'co-host');
    assert.equal((await db.query(
      'SELECT status FROM lynk_cohost_invites WHERE id=1',
    )).rows[0].status,'accepted');
    assert.equal((await accept(1,'cohost')).reason,'invite_resolved');
    assert.equal((await accept(2,'late')).reason,'room_full');
    assert.equal((await db.query(
      'SELECT status FROM lynk_cohost_invites WHERE id=2',
    )).rows[0].status,'pending', 'a full room must not burn the invite');

    await db.exec("INSERT INTO video_room_members(room_id,user_id,status) VALUES (8,'banned','kicked')");
    assert.equal((await accept(3,'banned')).reason,'member_banned');
  } finally { await db.close(); }
});

test('cohost role promotion retains an anonymous participant identity', async () => {
  const db=await fixture();
  try{
    const joined=await admit(db,8,'private',true);
    assert.equal(joined.anonLabel,'Anon 1');
    await db.exec("INSERT INTO video_room_members(room_id,user_id,role) VALUES (8,'host','host')");
    await db.exec("INSERT INTO lynk_cohost_invites(room_id,inviter_id,invitee_id) VALUES(8,'host','private')");
    const {rows}=await db.query("SELECT public.lynk_accept_cohost_atomic(1,'private') AS result");
    assert.equal(rows[0].result.ok,true);
    const {rows:members}=await db.query("SELECT is_anonymous,anon_label,role FROM video_room_members WHERE room_id=8 AND user_id='private'");
    assert.equal(members[0].is_anonymous,true);
    assert.equal(members[0].anon_label,'Anon 1');
    assert.equal(members[0].role,'co-host');
  } finally {await db.close();}
});

test('old invitations cannot grant a cohost seat after the inviter loses authority', async () => {
  const db=await fixture();
  try {
    await db.exec(`
      INSERT INTO video_room_members(room_id,user_id,role,status)
      VALUES (7,'host','host','active');
      INSERT INTO lynk_cohost_invites(room_id,inviter_id,invitee_id)
      VALUES (7,'host','future-cohost');
      UPDATE video_room_members SET status='left' WHERE room_id=7 AND user_id='host';
    `);
    const {rows}=await db.query("SELECT public.lynk_accept_cohost_atomic(1,'future-cohost') AS result");
    assert.equal(rows[0].result.reason,'inviter_unavailable');
    assert.equal((await db.query("SELECT status FROM lynk_cohost_invites WHERE id=1")).rows[0].status,'pending');
    assert.equal((await db.query("SELECT count(*)::integer AS n FROM video_room_members WHERE user_id='future-cohost'")).rows[0].n,0);
  } finally {await db.close();}
});

test('a demoted inviter cannot authorize a new hosting role',async()=>{
  const db=await fixture();
  try {
    await db.exec(`
      INSERT INTO video_room_members(room_id,user_id,role,status)
      VALUES (7,'host','participant','active');
      INSERT INTO lynk_cohost_invites(room_id,inviter_id,invitee_id)
      VALUES (7,'host','future-cohost');
    `);
    const {rows}=await db.query("SELECT public.lynk_accept_cohost_atomic(1,'future-cohost') AS result");
    assert.equal(rows[0].result.reason,'inviter_unavailable');
  } finally {await db.close();}
});
