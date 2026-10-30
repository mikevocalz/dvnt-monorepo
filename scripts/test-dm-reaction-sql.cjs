/** Disposable embedded PostgreSQL; never connects to a hosted project. */
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const readiness = fs.readFileSync(path.join(__dirname, 'verify-dm-reactions-readiness.sql'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../apps/mobile/supabase/migrations/20260905123000_atomic_message_reactions.sql'), 'utf8');

test('atomic DM reaction migration: persistence, idempotency, membership, blocks and service-only access', async () => {
  const db = new PGlite();
  try {
    await db.exec(`
      create role anon; create role authenticated; create role service_role;
      create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text);
      create table users(id integer primary key, auth_id text unique, username text);
      create table conversations(id integer primary key, is_group boolean);
      create table conversations_rels(parent_id integer, users_id text);
      create table messages(id integer primary key, conversation_id integer, sender_id integer, metadata jsonb);
      create table blocks(blocker_id integer, blocked_id integer);
      insert into users values (1,'fixture-a','alice'),(2,'fixture-b','bob'),(3,'fixture-stranger','stranger');
      insert into conversations values (10,false);
      insert into conversations_rels values (10,'fixture-a'),(10,'fixture-b');
      insert into messages values (100,10,1,'{"type":"image","mediaUrl":"fixture-only","reactions":[]}');
    `);
    const exists = async () => (await db.query(`select to_regprocedure('public.set_message_reaction(bigint,text,text,boolean)') is not null as present`)).rows[0].present;
    assert.equal(await exists(), false, 'missing migration is detectable before a real user attempts to react');
    assert.equal((await db.query(readiness)).rows[0].rpc_installed, false);
    await db.exec(migration);
    assert.equal(await exists(), true);
    let ready = (await db.query(readiness)).rows[0];
    assert.equal(ready.rpc_service_only, true);
    assert.equal(ready.migration_recorded, false);
    assert.equal(ready.realtime_published, false);
    await db.exec("insert into supabase_migrations.schema_migrations values ('20260905123000'); create publication supabase_realtime for table public.messages;");
    assert.deepEqual((await db.query(readiness)).rows[0], {rpc_installed:true, migration_recorded:true, realtime_published:true, rpc_service_only:true});
    const react = async (auth, emoji = '❤️', present = true, message = 100) =>
      (await db.query('select public.set_message_reaction($1::bigint,$2::text,$3::text,$4::boolean) result', [message,auth,emoji,present])).rows[0].result;
    let result = await react('fixture-b');
    assert.equal(result.ok, true);
    assert.equal(result.toggled, 'added');
    assert.deepEqual(result.reactions, [{emoji:'❤️', userId:'2', username:'bob'}]);
    assert.equal((await react('fixture-b')).toggled, 'unchanged', 'retrying desired=true never toggles off');
    result = await react('fixture-a', '😂');
    assert.equal(result.reactions.length, 2, 'another participant does not overwrite existing reactions');
    const persisted = (await db.query('select metadata from messages where id=100')).rows[0].metadata;
    assert.equal(persisted.mediaUrl, 'fixture-only');
    assert.equal(persisted.reactions.length, 2, 'reload retains canonical result');
    result = await react('fixture-b', '❤️', false);
    assert.equal(result.toggled, 'removed');
    assert.deepEqual(result.reactions, [{emoji:'😂',userId:'1',username:'alice'}]);
    assert.equal((await react('fixture-b', '❤️', false)).toggled, 'unchanged');
    assert.equal((await react('fixture-stranger')).code, 'forbidden');
    assert.equal((await react('missing-fixture')).code, 'unauthorized');
    assert.equal((await react('fixture-b','not-allowed')).code, 'bad_request');
    assert.equal((await react('fixture-b','❤️',true,999)).code, 'not_found');
    await db.exec('insert into blocks values (1,2)');
    assert.equal((await react('fixture-b')).code, 'forbidden');
    assert.equal((await react('fixture-a')).code, 'forbidden', 'cannot react to own message inside a blocked DM');
    await db.exec('delete from blocks; insert into blocks values (2,1)');
    assert.equal((await react('fixture-b')).code, 'forbidden', 'reverse block direction is respected');
    await db.exec('delete from blocks');
    for (const role of ['anon','authenticated']) {
      await db.exec(`set role ${role}`);
      await assert.rejects(react('fixture-b'), /permission denied for function set_message_reaction/);
      await db.exec('reset role');
    }
    await db.exec('set role service_role');
    assert.equal((await react('fixture-b')).ok, true);
    await db.exec('reset role');
    await db.exec(migration);
    assert.equal((await react('fixture-b')).toggled, 'unchanged', 'applying the reviewed migration twice preserves state');
  } finally { await db.close(); }
});
