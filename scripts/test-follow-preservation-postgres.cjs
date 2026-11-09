// Real PostgreSQL, separate connections, synthetic identities only. Never accept
// a hosted URL: every run owns a randomly named disposable local database.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { randomUUID } = require('node:crypto');
const { Client } = require('pg');
const { join } = require('node:path');
const migrationDir = join(__dirname, '../apps/mobile/supabase/migrations');
const migration = readFileSync(join(migrationDir, '20261109110000_private_follow_requests.sql'), 'utf8');
const cutoverSql = readFileSync(join(__dirname, '../docs/security/private-follow-preservation-cutover.sql'), 'utf8');
const gate = readFileSync(join(migrationDir, '20261109114000_post_follow_read_gate.sql'), 'utf8');
const ageGate = readFileSync(join(migrationDir, '20261003170200_spicy_viewing_excludes_minors.sql'), 'utf8');
const configured = process.env.FOLLOW_FIXTURE_DATABASE_URL;
assert.ok(configured, 'Set FOLLOW_FIXTURE_DATABASE_URL to a disposable localhost PostgreSQL server');
const base = new URL(configured);
assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname), 'Refusing a nonlocal PostgreSQL server');
assert.ok(['postgres', 'template1'].includes(base.pathname.slice(1)), 'Use an administrative fixture database, not an application database');

const fixtureSql = `
  CREATE SCHEMA auth;
  CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
    SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
  $$;
  GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
  GRANT EXECUTE ON FUNCTION auth.jwt() TO anon,authenticated,service_role;
  CREATE TABLE users(id integer PRIMARY KEY,auth_id text UNIQUE,is_private boolean);
  CREATE TABLE user_settings(id serial PRIMARY KEY,auth_id text UNIQUE,settings jsonb);
  CREATE TABLE follows(id serial PRIMARY KEY,follower_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
    following_id integer NOT NULL REFERENCES users ON DELETE CASCADE,
    created_at timestamptz DEFAULT now(),updated_at timestamptz DEFAULT now());
  CREATE UNIQUE INDEX follower_following_idx ON follows(follower_id,following_id);
  CREATE TABLE blocks(blocker_id integer,blocked_id integer);
  CREATE TABLE posts(id bigint PRIMARY KEY,author_id integer,is_nsfw boolean,content text);
  CREATE TABLE posts_media(id bigint PRIMARY KEY,_parent_id bigint,url text,type text DEFAULT 'image',_order integer DEFAULT 0);
  CREATE TABLE post_text_slides(id bigint PRIMARY KEY,post_id bigint,content text);
  CREATE TABLE comments(id bigint PRIMARY KEY,post_id bigint,content text);
  CREATE TABLE identity_verifications(user_id text,date_of_birth date);
  CREATE FUNCTION viewer_user_id() RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
    SELECT id FROM users WHERE auth_id=auth.jwt()->>'sub';
  $$;
  CREATE FUNCTION viewer_is_verified_adult() RETURNS boolean LANGUAGE sql AS $$ SELECT false; $$;
  ALTER TABLE posts ENABLE ROW LEVEL SECURITY;
  ALTER TABLE posts_media ENABLE ROW LEVEL SECURITY;
  ALTER TABLE post_text_slides ENABLE ROW LEVEL SECURITY;
  ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
  CREATE POLICY old_public ON posts FOR SELECT USING(true);
  CREATE POLICY old_public ON posts_media FOR SELECT USING(true);
  CREATE POLICY old_public ON post_text_slides FOR SELECT USING(true);
  CREATE POLICY old_public ON comments FOR SELECT USING(true);
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO anon,authenticated;
  GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
  GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO service_role;
  -- Match the former permissive direct-write boundary, including column grants.
  GRANT INSERT,UPDATE,DELETE ON follows TO anon,authenticated;
  GRANT UPDATE(follower_id,following_id) ON follows TO PUBLIC;
  INSERT INTO users VALUES(1,'viewer',false),(2,'private-owner',true),(3,'public-owner',false),
    (4,'minor',false),(5,'new-follower',false),(6,'another-viewer',false);
  INSERT INTO follows(follower_id,following_id) VALUES(1,2),(1,3),(4,2);
  INSERT INTO posts VALUES(21,2,false,'private safe'),(22,2,true,'private spicy'),
    (31,3,false,'public safe'),(32,3,true,'public spicy');
  INSERT INTO posts_media(id,_parent_id,url) SELECT id,id,'https://fixture.invalid/'||id FROM posts;
  INSERT INTO post_text_slides SELECT id,id,'synthetic slide' FROM posts;
  INSERT INTO comments SELECT id,id,'synthetic comment' FROM posts;
  INSERT INTO identity_verifications VALUES('minor',CURRENT_DATE-INTERVAL '15 years');
`;

async function fixture() {
  const admin = new Client({ connectionString: base.toString() });
  await admin.connect();
  for (const role of ['anon', 'authenticated', 'service_role']) {
    await admin.query(`DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='${role}') THEN
      CREATE ROLE ${role} ${role === 'service_role' ? 'BYPASSRLS' : ''}; END IF; END $$;`);
  }
  const name = 'follow_fixture_' + randomUUID().replaceAll('-', '');
  await admin.query(`CREATE DATABASE ${name}`);
  const url = new URL(base); url.pathname = '/' + name;
  const connections = [];
  async function connect(label = 'follow-fixture') {
    const db = new Client({ connectionString: url.toString(), application_name: label });
    await db.connect(); connections.push(db); return db;
  }
  const db = await connect('follow-fixture-primary');
  await db.query(fixtureSql);
  await db.query(migration);
  await installGate(db);
  return { db, connect, async close() {
    await Promise.all(connections.map(c => c.end()));
    await admin.query(`DROP DATABASE ${name} WITH (FORCE)`); await admin.end();
  } };
}
async function call(db, actor, target, action = 'status') {
  return (await db.query('SELECT mutate_follow_relationship($1,$2,$3) result', [actor,target,action])).rows[0].result;
}
async function count(db, table) { return Number((await db.query(`SELECT count(*) n FROM ${table}`)).rows[0].n); }
async function waiting(db, client) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const { rows } = await db.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1', [client.processID]);
    if (rows[0]?.wait_event_type === 'Lock') return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  throw new Error('Expected the second PostgreSQL connection to wait on an actual lock');
}
function openMigration() {
  assert.match(cutoverSql, /COMMIT;/);
  return cutoverSql.replace(/COMMIT;/, '');
}
async function as(db, role, subject, run) {
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role, sub: subject })]);
  await db.query(`SET ROLE ${role}`);
  try { return await run(); } finally { await db.query('RESET ROLE'); }
}
async function visible(db, subject) {
  return as(db, 'authenticated', subject, async () => {
    const answer = {};
    for (const table of ['posts','posts_media','post_text_slides','comments']) {
      answer[table] = (await db.query(`SELECT id FROM ${table} ORDER BY id`)).rows.map(r => Number(r.id));
    }
    return answer;
  });
}
const expected = ids => Object.fromEntries(['posts','posts_media','post_text_slides','comments'].map(t => [t,ids]));
async function installGate(db) {
  await db.query(ageGate);
  await db.query(`CREATE POLICY spicy_requires_verified_viewer ON posts_media AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(NOT post_spicy_hidden(_parent_id));
    CREATE POLICY spicy_requires_verified_viewer ON post_text_slides AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(NOT post_spicy_hidden(post_id));`);
  await db.query(gate);
}

test('PostgreSQL preserves exact existing incarnations, including Public to Private, without approval or count changes', async () => {
  const f = await fixture(); const { db } = f;
  try {
    const before = (await db.query('SELECT * FROM follows ORDER BY id')).rows;
    await db.query(cutoverSql);
    assert.deepEqual((await db.query('SELECT * FROM follows ORDER BY id')).rows, before);
    assert.equal(await count(db, 'follow_legacy_access'), 3);
    assert.equal(await count(db, 'follow_requests'), 0);
    assert.equal((await call(db,1,2)).following, true);
    assert.equal((await call(db,1,2,'follow')).followRequestStatus, 'none');
    await db.query('UPDATE users SET is_private=true WHERE id=3');
    assert.equal((await call(db,1,3)).following, true);
    assert.equal((await call(db,5,2,'follow')).followRequestStatus, 'pending');
    assert.equal((await call(db,5,2)).following, false);
    for (const role of ['anon','authenticated']) await as(db,role,'viewer', async () => {
      await assert.rejects(db.query('INSERT INTO follows(follower_id,following_id) VALUES(6,2)'), e => e.code === '42501');
      await assert.rejects(db.query('UPDATE follows SET following_id=3 WHERE follower_id=4'), e => e.code === '42501');
      await assert.rejects(db.query('SELECT * FROM follow_legacy_access'), e => e.code === '42501');
      await assert.rejects(db.query('SELECT * FROM follow_access_cutovers'), e => e.code === '42501');
    });
    assert.deepEqual(await visible(db,'viewer'), expected([21,22,31,32]));
    assert.deepEqual(await visible(db,'minor'), expected([21]));
    assert.deepEqual(await visible(db,'new-follower'), expected([]));
    for (const [blocker,blocked] of [[1,2],[2,1]]) {
      await db.query('INSERT INTO blocks VALUES($1,$2)', [blocker,blocked]);
      assert.deepEqual(await visible(db,'viewer'), expected([31,32]));
      const projection = (await db.query('SELECT * FROM post_relationship_access($1,$2)',[1,[2,3]])).rows;
      assert.equal(projection.find(r => Number(r.author_id) === 2).is_blocked, true);
      await db.query('DELETE FROM blocks');
    }
    assert.deepEqual(await visible(db,'viewer'), expected([21,22,31,32]));
  } finally { await f.close(); }
});

test('deletion, identity update, owner removal and backdated reinsertion never restore a grant or approval', async () => {
  const f = await fixture(); const { db } = f;
  try {
    await db.query(cutoverSql);
    const id = (await db.query('SELECT id FROM follows WHERE follower_id=1 AND following_id=2')).rows[0].id;
    await call(db,1,2,'unfollow');
    await db.query("INSERT INTO follows(id,follower_id,following_id,created_at) VALUES($1,1,2,'2000-01-01')", [id]);
    await db.query(cutoverSql);
    assert.equal((await call(db,1,2)).following, false);
    assert.equal(await count(db,'follow_legacy_access'), 2);
    await call(db,1,2,'follow'); await call(db,2,1,'approve');
    assert.equal((await call(db,1,2)).following, true);
    await db.query('DELETE FROM follows WHERE follower_id=1 AND following_id=2');
    await db.query('INSERT INTO follows(id,follower_id,following_id) VALUES($1,1,2)',[id]);
    assert.equal((await call(db,1,2)).following, false, 'approval does not survive direct owner removal and reinsertion');
    await db.query('UPDATE follows SET follower_id=6 WHERE follower_id=4 AND following_id=2');
    assert.equal((await call(db,6,2)).following, false);
    await db.query('UPDATE follows SET follower_id=4 WHERE follower_id=6 AND following_id=2');
    assert.equal((await call(db,4,2)).following, false);
    await db.query('UPDATE follows SET id=id+1000 WHERE follower_id=1 AND following_id=3');
    assert.equal(await count(db,'follow_legacy_access'), 0);
    await db.query('UPDATE users SET is_private=true WHERE id=3');
    assert.equal((await call(db,1,3)).following, false);
    await db.query(cutoverSql);
    assert.equal(await count(db,'follow_legacy_access'), 0, 'completed marker must not recapture current rows');
  } finally { await f.close(); }
});

test('cutover waits for old direct writers and snapshots their committed result', async () => {
  const f = await fixture(); const { db } = f;
  const writer = await f.connect('old-follow-writer'); const cutover = await f.connect('cutover');
  try {
    await writer.query('BEGIN; INSERT INTO follows(follower_id,following_id) VALUES(5,2); DELETE FROM follows WHERE follower_id=4');
    const pending = cutover.query(cutoverSql);
    await waiting(db,cutover);
    assert.equal((await db.query("SELECT ready FROM follow_access_cutovers WHERE batch_id='private-follow-v1'")).rows[0].ready, false);
    await writer.query('COMMIT'); await pending;
    assert.equal((await call(db,5,2)).following, true, 'committed before snapshot is preserved');
    assert.equal((await call(db,4,2)).following, false, 'committed deletion is not captured');
    assert.equal(await count(db,'follow_legacy_access'),3);
  } finally { await writer.query('ROLLBACK'); await f.close(); }
});

test('late direct insert and concurrent privacy/block writes serialize after the one-shot boundary', async () => {
  const f = await fixture(); const { db } = f;
  const cutover = await f.connect('cutover'); const late = await f.connect('late-follow');
  const privacy = await f.connect('privacy-change'); const block = await f.connect('block-change');
  try {
    await cutover.query(openMigration());
    const insert = late.query("INSERT INTO follows(follower_id,following_id,created_at) VALUES(5,2,'1999-01-01')");
    const change = privacy.query('UPDATE users SET is_private=true WHERE id=3');
    const blocked = block.query('INSERT INTO blocks VALUES(2,1)');
    await waiting(db,late); await waiting(db,privacy); await waiting(db,block);
    await cutover.query('COMMIT'); await Promise.all([insert,change,blocked]);
    assert.equal((await call(db,5,2)).following,false,'backdated transaction queued after barrier cannot be captured');
    assert.equal((await call(db,1,3)).following,true,'existing public follow survives concurrent Private change');
    assert.deepEqual(await visible(db,'viewer'),expected([31,32]),'block wins after serialization');
    await db.query(cutoverSql);
    assert.equal(await count(db,'follow_legacy_access'),3,'retry cannot add late relationships');
  } finally { await cutover.query('ROLLBACK'); await f.close(); }
});

test('rollback has no partial readiness or grants; retry captures only the new committed boundary', async () => {
  const f = await fixture(); const { db } = f; const cutover = await f.connect('rolled-back-cutover');
  try {
    await cutover.query("SET default_transaction_isolation='repeatable read'");
    await cutover.query(openMigration());
    assert.equal((await cutover.query('SHOW transaction_isolation')).rows[0].transaction_isolation,'read committed');
    assert.equal((await cutover.query("SELECT ready FROM follow_access_cutovers WHERE batch_id='private-follow-v1'")).rows[0].ready,true);
    assert.equal((await db.query("SELECT ready FROM follow_access_cutovers WHERE batch_id='private-follow-v1'")).rows[0].ready,false);
    await cutover.query('ROLLBACK');
    assert.equal(await count(db,'follow_legacy_access'),0);
    assert.equal((await db.query("SELECT ready FROM follow_access_cutovers WHERE batch_id='private-follow-v1'")).rows[0].ready,false);
    await db.query('DELETE FROM follows WHERE follower_id=4; INSERT INTO follows(follower_id,following_id) VALUES(5,2)');
    await db.query(cutoverSql);
    assert.equal((await call(db,4,2)).following,false);
    assert.equal((await call(db,5,2)).following,true);
    const marker = (await db.query("SELECT * FROM follow_access_cutovers WHERE batch_id='private-follow-v1'")).rows[0];
    assert.equal(Number(marker.relationship_count),3);
    assert.equal(marker.ready,true);
    await assert.rejects(db.query("UPDATE follow_access_cutovers SET ready=false WHERE batch_id='private-follow-v1'"), e => e.code === '23514');
    await db.query('DELETE FROM follow_legacy_access; DELETE FROM follow_access_cutovers');
    await assert.rejects(db.query('SELECT * FROM post_relationship_access($1,$2)',[1,[2]]));
    await assert.rejects(db.query(gate)); await db.query('ROLLBACK');
  } finally { await cutover.query('ROLLBACK'); await f.close(); }
});

test('busy write barrier aborts within its configured timeout and leaves old state intact', { timeout: 15000 }, async () => {
  const f = await fixture(); const { db } = f; const writer = await f.connect('long-old-writer');
  const cutover = await f.connect('bounded-cutover');
  try {
    await writer.query('BEGIN; UPDATE users SET is_private=true WHERE id=3');
    const start = Date.now();
    const pending = cutover.query(cutoverSql);
    await waiting(db,cutover);
    await assert.rejects(pending, e => e.code === '55P03');
    assert.ok(Date.now()-start < 12000, 'bounded lock wait must not hang release indefinitely');
    await cutover.query('ROLLBACK'); await writer.query('ROLLBACK');
    assert.equal(await count(db,'follow_legacy_access'),0);
    assert.equal((await db.query("SELECT ready FROM follow_access_cutovers WHERE batch_id='private-follow-v1'")).rows[0].ready,false);
    assert.equal(await count(db,'follows'),3);
    await db.query(cutoverSql);
    assert.equal((await call(db,1,2)).following,true);
  } finally { await writer.query('ROLLBACK'); await cutover.query('ROLLBACK'); await f.close(); }
});

test('staged schema, new RPC and staged RLS preserve the legacy mode before activation', async () => {
  const f = await fixture(); const { db } = f;
  try {
    assert.equal((await db.query("SELECT ready FROM follow_access_cutovers WHERE batch_id='private-follow-v1'")).rows[0].ready,false);
    assert.equal(await count(db,'follow_legacy_access'),0);
    assert.equal((await call(db,1,2)).following,true);
    assert.equal((await call(db,5,2,'follow')).following,true,'new handler preserves legacy private follow before switch');
    assert.equal(await count(db,'follow_requests'),0);
    assert.deepEqual(await visible(db,'another-viewer'),expected([21,22,31,32]),'staged restrictive policy does not change prior read policy');
    await db.query(cutoverSql);
    assert.equal((await call(db,5,2)).following,true,'pre-switch compatible follow is captured');
    assert.deepEqual(await visible(db,'another-viewer'),expected([31]));
    assert.equal((await call(db,6,2,'follow')).followRequestStatus,'pending');
  } finally { await f.close(); }
});

test('new handler waits before reading activation and cannot carry a stale compatibility decision across cutover', async () => {
  const f = await fixture(); const { db } = f;
  const before = await f.connect('pre-cutover-compatible-rpc');
  const cutover = await f.connect('atomic-cutover'); const after = await f.connect('post-cutover-compatible-rpc');
  try {
    await before.query('BEGIN');
    assert.equal((await call(before,5,2,'follow')).following,true);
    const activating = cutover.query(openMigration());
    await waiting(db,cutover);
    await before.query('COMMIT'); await activating;
    const following = call(after,6,2,'follow');
    await waiting(db,after);
    // The staged reader has a consistent committed pre-switch view while the
    // transaction is not committed, rather than observing half of a backfill.
    assert.equal((await db.query("SELECT ready FROM follow_access_cutovers WHERE batch_id='private-follow-v1'")).rows[0].ready,false);
    assert.equal((await call(db,5,2)).following,true);
    await cutover.query('COMMIT');
    assert.equal((await following).followRequestStatus,'pending');
    assert.equal((await call(db,6,2)).following,false);
    assert.equal((await call(db,5,2)).following,true);
    assert.equal(await count(db,'follow_legacy_access'),4);
  } finally { await before.query('ROLLBACK'); await cutover.query('ROLLBACK'); await f.close(); }
});

test('concurrent approval and cancellation serialize without resurrecting authorization', async () => {
  const f = await fixture(); const { db } = f;
  const approve = await f.connect('owner-approval'); const cancel = await f.connect('requester-cancellation');
  try {
    await db.query(cutoverSql);
    await call(db,5,2,'follow');
    await approve.query('BEGIN'); await call(approve,2,5,'approve');
    const cancellation = call(cancel,5,2,'unfollow'); await waiting(db,cancel);
    await approve.query('COMMIT'); await cancellation;
    assert.equal((await call(db,5,2)).following,false);
    assert.equal((await call(db,5,2)).followRequestStatus,'none');
    await call(db,2,5,'approve');
    assert.equal((await call(db,5,2)).following,false);
    assert.equal((await call(db,5,2,'follow')).followRequestStatus,'pending');
  } finally { await approve.query('ROLLBACK'); await f.close(); }
});

test('post-cutover Public follows retain honest acceptance after Private, but deletion never restores it', async () => {
  const f = await fixture(); const { db } = f;
  try {
    await db.query(cutoverSql);
    await call(db,5,3,'follow');
    const id = (await db.query('SELECT id FROM follows WHERE follower_id=5 AND following_id=3')).rows[0].id;
    assert.equal(await count(db,'public_follow_acceptances'),1);
    assert.equal(await count(db,'follow_requests'),0,'Public acceptance is never recorded as owner approval');
    await db.query("INSERT INTO user_settings(auth_id,settings) VALUES('public-owner','{\"privacy\":{\"privateAccount\":true}}')");
    assert.equal((await call(db,5,3)).following,true);
    assert.deepEqual(await visible(db,'new-follower'),expected([31,32]));
    await db.query('DELETE FROM follows WHERE id=$1',[id]);
    assert.equal(await count(db,'public_follow_acceptances'),0);
    await db.query("INSERT INTO follows(id,follower_id,following_id,created_at) VALUES($1,5,3,'1990-01-01')",[id]);
    assert.equal((await call(db,5,3)).following,false);
    assert.equal((await call(db,5,3)).followRequestStatus,'pending');
    assert.equal(await count(db,'public_follow_acceptances'),0);
    await db.query(cutoverSql);
    assert.equal((await call(db,5,3)).following,false);
  } finally { await f.close(); }
});

test('real privacy/follow races use one serial order for Public acceptance and pending Private requests', async () => {
  const f = await fixture(); const { db } = f;
  const following = await f.connect('follow-first'); const privacy = await f.connect('privacy-first');
  try {
    await db.query(cutoverSql);
    await following.query('BEGIN');
    assert.equal((await call(following,5,3,'follow')).following,true);
    const privateAfter = privacy.query("INSERT INTO user_settings(auth_id,settings) VALUES('public-owner','{\"privacy\":{\"privateAccount\":true}}')");
    await waiting(db,privacy); await following.query('COMMIT'); await privateAfter;
    assert.equal((await call(db,5,3)).following,true,'Public follow committed first retains access');
    await db.query("UPDATE user_settings SET settings='{\"privacy\":{\"privateAccount\":false}}' WHERE auth_id='public-owner'");
    await privacy.query('BEGIN');
    await privacy.query("UPDATE user_settings SET settings='{\"privacy\":{\"privateAccount\":true}}' WHERE auth_id='public-owner'");
    const followAfter = call(following,6,3,'follow');
    await waiting(db,following); await privacy.query('COMMIT');
    assert.equal((await followAfter).followRequestStatus,'pending');
    assert.equal((await call(db,6,3)).following,false,'Private change committed first requires approval');
    assert.equal((await call(db,5,3)).following,true);
    assert.equal(await count(db,'public_follow_acceptances'),1);
  } finally { await following.query('ROLLBACK'); await privacy.query('ROLLBACK'); await f.close(); }
});

test('direct service writers cannot bypass Private approval; Public inserts and user deletion obey incarnation lifetime', async () => {
  const f = await fixture(); const { db } = f;
  try {
    await db.query(cutoverSql);
    await as(db,'service_role','',()=>db.query('INSERT INTO follows(follower_id,following_id) VALUES(5,2),(6,3)'));
    assert.equal((await call(db,5,2)).followRequestStatus,'pending');
    assert.equal((await db.query('SELECT count(*)::int n FROM follows WHERE follower_id=5')).rows[0].n,0);
    assert.equal(await count(db,'public_follow_acceptances'),1);
    await db.query('DELETE FROM users WHERE id=6');
    assert.equal(await count(db,'public_follow_acceptances'),0);
    await db.query('DELETE FROM users WHERE id=4');
    assert.equal(await count(db,'follow_legacy_access'),2);
    await db.query('DELETE FROM users WHERE id=2');
    assert.equal(await count(db,'follow_legacy_access'),1);
    assert.equal(await count(db,'follow_requests'),0);
  } finally { await f.close(); }
});

async function installBrandWriterFunctions(db) {
  const onboarding = readFileSync(join(migrationDir,'20261001194000_deviantevents_onboarding_retention.sql'),'utf8');
  const recovery = readFileSync(join(migrationDir,'20261009003000_brand_profile_recovery.sql'),'utf8');
  for (const [source, names] of [
    [onboarding,['brand_follow_eligible','ensure_brand_follow_relationships','backfill_brand_follows']],
    [recovery,['repair_canonical_brand_follows']],
  ]) for (const name of names) {
    const definition = source.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$\\$;`));
    assert.ok(definition, `exact source function ${name}`);
    await db.query(definition[0]);
    const acl = source.match(new RegExp(`(?:REVOKE|GRANT)[^;]* ON FUNCTION public\\.${name}\\([^;]*;`, 'g'));
    assert.equal(acl?.length,2,`${name} has explicit source ACL`);
    for (const statement of acl) await db.query(statement);
  }
  return recovery;
}

for (const writerName of ['ensure_brand_follow_relationships','backfill_brand_follows','repair_canonical_brand_follows']) {
  test(`actual ${writerName} preserves Public acceptance, queues Private requests and remains repeatable`, async () => {
    const f = await fixture(); const { db } = f;
    try {
      await db.query(`ALTER TABLE users ADD COLUMN banned_at timestamptz, ADD COLUMN created_at timestamptz DEFAULT now(), ADD COLUMN username text;
        CREATE TABLE public."user"(id text PRIMARY KEY,banned boolean);
        CREATE SCHEMA payload; CREATE TABLE payload.members(app_user_id text,status text);
        INSERT INTO public."user"(id,banned) SELECT auth_id,false FROM users;`);
      const source = await installBrandWriterFunctions(db);
      // The recovery function pins its canonical numeric identity. Read that
      // constant from the actual source; do not copy any real account identifier
      // into this test. All account content/credentials are synthetic and local.
      const brandId = Number(source.match(/WHERE u\.id = (\d+) AND lower\(u\.username\)/)[1]);
      const brandUsername = source.match(/lower\(u\.username\) = '([^']+)'/)[1];
      await db.query('INSERT INTO users(id,auth_id,is_private,username) VALUES($1,$2,false,$3)',[brandId,'fixture-brand-auth',brandUsername]);
      await db.query('INSERT INTO public."user"(id,banned) VALUES($1,false)',['fixture-brand-auth']);
      await db.query(cutoverSql);
      const execute = () => as(db,'service_role','',async () => {
        if (writerName === 'ensure_brand_follow_relationships') {
          const privateResult = (await db.query('SELECT ensure_brand_follow_relationships(2,$1,true) result',[brandId])).rows[0].result;
          const publicResult = (await db.query('SELECT ensure_brand_follow_relationships(3,$1,true) result',[brandId])).rows[0].result;
          return { privateResult,publicResult };
        }
        return (await db.query(writerName === 'backfill_brand_follows'
          ? 'SELECT backfill_brand_follows($1,250) result' : 'SELECT repair_canonical_brand_follows(250) result',
        writerName === 'backfill_brand_follows' ? [brandId] : [])).rows[0].result;
      });
      const first = await execute();
      if (writerName === 'ensure_brand_follow_relationships') {
        assert.equal(first.privateResult.memberToBrand,1);
        assert.equal(first.privateResult.brandToMember,0,'suppressed private insert has honest zero row count');
        assert.equal(first.publicResult.memberToBrand,1);
        assert.equal(first.publicResult.brandToMember,1);
      } else {
        assert.ok(first.memberToBrandInserted > 0);
        assert.ok(first.brandToNewMemberInserted > 0);
      }
      assert.equal((await call(db,brandId,2)).following,false);
      assert.equal((await call(db,brandId,2)).followRequestStatus,'pending');
      assert.equal((await call(db,brandId,3)).following,true);
      assert.equal((await call(db,2,brandId)).following,true);
      const follows = await count(db,'follows'); const requests = await count(db,'follow_requests');
      const second = await execute();
      assert.equal(await count(db,'follows'),follows);
      assert.equal(await count(db,'follow_requests'),requests,'repeat does not duplicate pending requests');
      if (writerName === 'ensure_brand_follow_relationships') {
        assert.equal(second.privateResult.memberToBrand,0); assert.equal(second.privateResult.brandToMember,0);
      } else {
        assert.equal(second.memberToBrandInserted,0); assert.equal(second.brandToNewMemberInserted,0);
      }
      await db.query('UPDATE users SET is_private=false WHERE id=2');
      await execute();
      assert.equal((await call(db,brandId,2)).following,true,'Private pending becomes a Public accepted follow on retry');
      assert.equal((await call(db,brandId,2)).followRequestStatus,'none','real brand retry clears only stale pending intent');
      await db.query('UPDATE users SET is_private=true WHERE id=2');
      assert.equal((await call(db,brandId,2)).following,true,'Public acceptance then survives Private again');
      await db.query('UPDATE users SET is_private=true WHERE id=3');
      assert.equal((await call(db,brandId,3)).following,true,'Public acceptance survives a later Private transition');
      for (const pair of [[brandId,3],[3,brandId]]) {
        await db.query('INSERT INTO blocks VALUES($1,$2)',pair);
        const blocked = (await db.query('SELECT * FROM post_relationship_access($1,$2)',[brandId,[3]])).rows[0];
        assert.equal(blocked.is_blocked,true);
        await db.query('DELETE FROM blocks');
        assert.equal((await call(db,brandId,3)).following,true,'unblock preserves the untouched relationship');
      }
    } finally { await f.close(); }
  });
}

for (const isolation of ['REPEATABLE READ','SERIALIZABLE']) {
  for (const mode of ['direct','RPC']) {
    for (const [privacy,target] of [['Private',2],['Public',3]]) {
      test(`${isolation} pre-cutover snapshot cannot escape activation through ${mode} ${privacy} follow`, async () => {
        const f = await fixture(); const { db } = f; const stale = await f.connect('stale-isolation-writer');
        try {
          await stale.query(`BEGIN ISOLATION LEVEL ${isolation}`);
          assert.equal((await stale.query("SELECT ready FROM follow_access_cutovers WHERE batch_id='private-follow-v1'")).rows[0].ready,false);
          await db.query(cutoverSql);
          const write = () => mode === 'direct'
            ? stale.query('INSERT INTO follows(follower_id,following_id) VALUES(5,$1) ON CONFLICT(follower_id,following_id) DO NOTHING',[target])
            : call(stale,5,target,'follow');
          await assert.rejects(write(),e => e.code === '40001','the stale compatibility decision must force transaction retry');
          await stale.query('ROLLBACK');
          assert.equal(await count(db,'follows'),3,'failed stale transaction creates no raw/grantless follow');
          assert.equal(await count(db,'follow_legacy_access'),3);
          assert.equal(await count(db,'public_follow_acceptances'),0);
          assert.equal(await count(db,'follow_requests'),0);
          await stale.query('BEGIN ISOLATION LEVEL READ COMMITTED');
          await write(); await stale.query('COMMIT');
          const result = await call(db,5,target);
          assert.equal(result.following,privacy === 'Public');
          assert.equal(result.followRequestStatus,privacy === 'Private' ? 'pending' : 'none');
          assert.equal(await count(db,'follows'),privacy === 'Public' ? 4 : 3);
          assert.equal(await count(db,'public_follow_acceptances'),privacy === 'Public' ? 1 : 0);
          assert.equal(await count(db,'follow_legacy_access'),3,'retry cannot become legacy');
        } finally { await stale.query('ROLLBACK'); await f.close(); }
      });
    }
  }
}

test('direct Private pending becomes Public acceptance on retry without erasing real approval', async () => {
  const f = await fixture(); const { db } = f;
  try {
    await db.query(cutoverSql);
    const insert = () => as(db,'service_role','',()=>db.query('INSERT INTO follows(follower_id,following_id) VALUES(5,2) ON CONFLICT(follower_id,following_id) DO NOTHING'));
    await insert();
    assert.equal((await call(db,5,2)).followRequestStatus,'pending');
    await db.query('UPDATE users SET is_private=false WHERE id=2');
    await insert();
    assert.equal((await call(db,5,2)).following,true);
    assert.equal((await call(db,5,2)).followRequestStatus,'none');
    assert.equal(await count(db,'public_follow_acceptances'),1);
    // This follows a real owner-approval path, not a fabricated approved row.
    await db.query('UPDATE users SET is_private=true WHERE id=2');
    await call(db,6,2,'follow');
    await db.query('UPDATE users SET is_private=false WHERE id=2');
    await call(db,2,6,'approve');
    assert.equal((await call(db,6,2)).followRequestStatus,'approved','Public insertion trigger preserves the real owner approval');
    assert.equal(await count(db,'public_follow_acceptances'),2);
    await as(db,'service_role','',()=>db.query('INSERT INTO follows(follower_id,following_id) VALUES(6,2) ON CONFLICT(follower_id,following_id) DO NOTHING'));
    assert.equal((await call(db,6,2)).followRequestStatus,'approved','a Public retry must retain recorded owner approval');
    assert.equal((await call(db,6,2)).following,true);
    await db.query('UPDATE users SET is_private=true WHERE id=2');
    assert.equal((await call(db,5,2)).following,true);
    assert.equal((await call(db,6,2)).following,true);
  } finally { await f.close(); }
});

for (const phase of ['staged','active']) for (const isolation of ['REPEATABLE READ','SERIALIZABLE']) {
  test(`${phase} ${isolation} rejects every follow write without changing rows or authorization`, async () => {
    const f = await fixture(); const { db } = f; const writer = await f.connect('unsupported-isolation-writer');
    try {
      if (phase === 'active') await db.query(cutoverSql);
      const snapshot = async () => ({
        follows: (await db.query('SELECT * FROM follows ORDER BY id')).rows,
        grants: (await db.query('SELECT * FROM follow_legacy_access ORDER BY follow_id')).rows,
        acceptances: (await db.query('SELECT * FROM public_follow_acceptances ORDER BY follow_id')).rows,
        requests: (await db.query('SELECT * FROM follow_requests ORDER BY follower_id,following_id')).rows,
      });
      const original = await snapshot();
      const operations = [
        ['Private INSERT',()=>writer.query('INSERT INTO follows(follower_id,following_id) VALUES(5,2)')],
        ['Public INSERT',()=>writer.query('INSERT INTO follows(follower_id,following_id) VALUES(5,3)')],
        ['id UPDATE',()=>writer.query('UPDATE follows SET id=id+1000 WHERE follower_id=1 AND following_id=2')],
        ['follower UPDATE',()=>writer.query('UPDATE follows SET follower_id=6 WHERE follower_id=1 AND following_id=2')],
        ['following UPDATE',()=>writer.query('UPDATE follows SET following_id=6 WHERE follower_id=1 AND following_id=2')],
        ['DELETE',()=>writer.query('DELETE FROM follows WHERE follower_id=1 AND following_id=2')],
        ...['follow','unfollow','toggle','approve','decline'].map(action=>[`RPC ${action}`,()=>call(writer,5,2,action)]),
      ];
      for (const [label,operation] of operations) {
        await writer.query(`BEGIN ISOLATION LEVEL ${isolation}`);
        assert.equal((await call(writer,1,2,'status')).following,true,'read-only status remains usable');
        await assert.rejects(operation(),e => e.code === '40001',label);
        await writer.query('ROLLBACK');
        assert.deepEqual(await snapshot(),original,`${label} leaves rows and authorization intact`);
      }
    } finally { await writer.query('ROLLBACK'); await f.close(); }
  });
}

for (const privilege of ['table','column']) {
  test(`cutover rolls back when an inherited ${privilege} grant keeps direct writes available`, async () => {
    const f = await fixture(); const { db } = f;
    const group = 'fixture_follow_writer_' + randomUUID().replaceAll('-','');
    try {
      await db.query(`CREATE ROLE ${group}; GRANT ${group} TO authenticated`);
      await db.query(privilege === 'table' ? `GRANT INSERT ON follows TO ${group}`
        : `GRANT INSERT(follower_id,following_id) ON follows TO ${group}`);
      const before = (await db.query('SELECT * FROM follows ORDER BY id')).rows;
      await assert.rejects(db.query(cutoverSql),new RegExp(`Inherited follow ${privilege} writes remain`));
      await db.query('ROLLBACK');
      assert.equal((await db.query("SELECT ready FROM follow_access_cutovers WHERE batch_id='private-follow-v1'")).rows[0].ready,false);
      assert.equal(await count(db,'follow_legacy_access'),0);
      assert.deepEqual((await db.query('SELECT * FROM follows ORDER BY id')).rows,before);
      assert.equal((await db.query("SELECT has_table_privilege('authenticated','public.follows','DELETE') allowed")).rows[0].allowed,true,
        'failed cutover rolls back direct revocations as well as capture');
      await db.query(`REVOKE ${group} FROM authenticated`);
      await db.query(cutoverSql);
      assert.equal((await call(db,1,2)).following,true);
      assert.equal((await db.query("SELECT has_table_privilege('authenticated','public.follows','INSERT,UPDATE,DELETE,TRUNCATE') allowed")).rows[0].allowed,false);
    } finally {
      await db.query('ROLLBACK');
      await db.query(`REVOKE ${group} FROM authenticated; DROP OWNED BY ${group}; DROP ROLE ${group}`);
      await f.close();
    }
  });
}
