const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { PGlite } = require('@electric-sql/pglite');
const migrations = path.join(__dirname, '../apps/mobile/supabase/migrations');
const followMigration = fs.readFileSync(path.join(migrations, '20261109110000_private_follow_requests.sql'), 'utf8');
const gate = fs.readFileSync(path.join(migrations, '20261109114000_post_follow_read_gate.sql'), 'utf8');
const existingAgeGate = fs.readFileSync(path.join(migrations, '20261003170200_spicy_viewing_excludes_minors.sql'), 'utf8');

const cutover=fs.readFileSync(path.join(__dirname,'../docs/security/private-follow-preservation-cutover.sql'),'utf8');
async function activate(db) { await db.exec(gate); await db.exec(cutover); }

async function fixture(preserve = false) {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$
      SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb;
    $$;
    GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
    GRANT EXECUTE ON FUNCTION auth.jwt() TO anon,authenticated,service_role;
    CREATE TABLE users(id integer PRIMARY KEY,auth_id text UNIQUE,is_private boolean);
    CREATE TABLE user_settings(id serial PRIMARY KEY,auth_id text UNIQUE,settings jsonb);
    CREATE TABLE posts(id bigint PRIMARY KEY,author_id integer,is_nsfw boolean,content text);
    CREATE TABLE posts_media(id bigint PRIMARY KEY,_parent_id bigint,url text,type text DEFAULT 'image',_order integer DEFAULT 0);
    CREATE TABLE post_text_slides(id bigint PRIMARY KEY,post_id bigint,content text);
    CREATE TABLE comments(id bigint PRIMARY KEY,post_id bigint,content text);
    CREATE TABLE follows(id serial PRIMARY KEY,follower_id bigint,following_id bigint,UNIQUE(follower_id,following_id));
    CREATE TABLE blocks(blocker_id bigint,blocked_id bigint);
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
    GRANT SELECT ON users,posts,posts_media,post_text_slides,comments,user_settings TO anon,authenticated;
    GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
    -- Deliberately permissive settings baseline proves the migration closes it.
    GRANT INSERT,UPDATE,DELETE ON user_settings TO anon,authenticated;
    GRANT UPDATE(settings) ON user_settings TO PUBLIC;
    INSERT INTO users VALUES(1,'author-public',false),(2,'viewer',false),(3,'author-private',true),
      (4,'author-pref',false),(5,'minor',false),(6,'stranger',false),(7,'malformed-private',false);
    INSERT INTO user_settings(auth_id,settings) VALUES('author-pref','{"privacy":{"privateAccount":true}}'),
      ('malformed-private','{"privacy":{"privateAccount":"unexpected"}}');
    INSERT INTO posts VALUES(11,1,true,'public spicy secret'),(12,1,false,'public safe'),
      (31,3,true,'private spicy secret'),(32,3,false,'private safe secret'),
      (41,4,true,'preference spicy secret'),(42,4,false,'preference safe secret'),
      (71,7,true,'malformed privacy secret');
    INSERT INTO posts_media(id,_parent_id,url) SELECT id,id,'https://fixture.invalid/secret/'||id FROM posts;
    INSERT INTO post_text_slides SELECT id,id,'slide secret '||id FROM posts;
    INSERT INTO comments SELECT id,id,'comment secret '||id FROM posts;
    INSERT INTO posts_media(id,_parent_id,url) VALUES(99,999,'orphan secret');
    INSERT INTO post_text_slides VALUES(99,999,'orphan secret');
    INSERT INTO identity_verifications VALUES('minor',CURRENT_DATE-INTERVAL '15 years');
  `);
  if(preserve) await db.exec('INSERT INTO follows(follower_id,following_id) VALUES(2,1),(2,3),(2,4),(5,1),(5,3)');
  await db.exec(followMigration);
  await db.exec(existingAgeGate);
  await db.exec(`CREATE POLICY spicy_requires_verified_viewer ON posts_media AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(NOT post_spicy_hidden(_parent_id));
    CREATE POLICY spicy_requires_verified_viewer ON post_text_slides AS RESTRICTIVE FOR SELECT TO anon,authenticated USING(NOT post_spicy_hidden(post_id));`);
  return db;
}

async function visible(db, subject, role = 'authenticated') {
  await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ role, ...(subject ? { sub: subject } : {}) })]);
  await db.exec(`SET ROLE ${role}`);
  try {
    const ids = async table => (await db.query(`SELECT id FROM ${table} ORDER BY id`)).rows.map(row => Number(row.id));
    return { posts: await ids('posts'), media: await ids('posts_media'), slides: await ids('post_text_slides'), comments: await ids('comments') };
  } finally { await db.exec('RESET ROLE'); }
}

test('real restrictive post and child gates enforce follows, approval and existing age policies', { timeout: 120000 }, async () => {
  const db = await fixture();
  try {
    assert.ok((await visible(db, 'viewer')).posts.includes(11), 'old signed-in policy permits unfollowed spicy');
    await activate(db);
    await activate(db);
    const expected = ids => ({ posts: ids, media: ids, slides: ids, comments: ids });
    assert.deepEqual(await visible(db, null, 'anon'), expected([12]));
    for (const id of [11,31,32,41,42,71]) {
      assert.equal((await db.query('SELECT public_post_share_preview($1) AS preview',[id])).rows[0].preview,null);
    }
    assert.deepEqual((await db.query('SELECT public_post_share_preview(12) AS preview')).rows[0].preview,
      {description:'public safe',image:'https://fixture.invalid/secret/12'});
    assert.deepEqual(await visible(db, 'viewer'), expected([12]));
    assert.deepEqual(await visible(db, 'author-public'), expected([11, 12]));
    assert.deepEqual(await visible(db, 'author-private'), expected([12, 31, 32]));
    await db.exec('INSERT INTO follows(follower_id,following_id) VALUES(2,1),(2,3),(2,4),(2,7),(5,1)');
    assert.deepEqual(await visible(db, 'viewer'), expected([11,12]), 'legacy private follows are not implicit approval');
    await db.query("SELECT mutate_follow_relationship(4,2,'approve'),mutate_follow_relationship(7,2,'approve')");
    assert.deepEqual(await visible(db, 'viewer'), expected([11,12,41,42,71]));
    assert.deepEqual(await visible(db, 'minor'), expected([12]), 'following does not bypass the existing age gate');
    await db.query("SELECT mutate_follow_relationship(3,2,'approve')");
    assert.deepEqual(await visible(db, 'viewer'), expected([11,12,31,32,41,42,71]));
    await db.exec('DELETE FROM follows WHERE follower_id=2 AND following_id=3');
    assert.deepEqual(await visible(db, 'viewer'), expected([11,12,41,42,71]), 'approval alone cannot survive unfollow');
    await db.exec('INSERT INTO blocks VALUES(1,2)');
    assert.deepEqual(await visible(db, 'viewer'), expected([41,42,71]), 'author block immediately revokes both public safe and spicy');
    await db.exec('DELETE FROM blocks; INSERT INTO blocks VALUES(2,1)');
    assert.deepEqual(await visible(db, 'viewer'), expected([41,42,71]), 'viewer block is symmetric');
    await db.exec('DELETE FROM blocks; DELETE FROM follows WHERE follower_id=2');
    assert.deepEqual(await visible(db, 'viewer'), expected([12]));
    const service = await visible(db, null, 'service_role');
    assert.equal(service.posts.length, 7, 'verified services retain explicit projection responsibility');
    assert.equal((await db.query("SELECT has_table_privilege('authenticated','user_settings','UPDATE') AS allowed")).rows[0].allowed, false);
    assert.equal((await db.query("SELECT has_column_privilege('anon','user_settings','settings','UPDATE') AS allowed")).rows[0].allowed, false);
    assert.equal((await db.query("SELECT count(*)::int AS n FROM pg_policies WHERE policyname='spicy_requires_verified_viewer'")).rows[0].n, 3);
    await db.exec(`INSERT INTO user_settings(auth_id,settings) VALUES('author-private','{"privacy":{"privateAccount":false}}');`);
    assert.equal((await db.query("SELECT is_private FROM users WHERE id=3")).rows[0].is_private,false,'explicit Public clears legacy canonical flag atomically');
    await db.exec(`UPDATE user_settings SET settings='{"privacy":{"privateAccount":true}}' WHERE auth_id='author-private';`);
    assert.equal((await db.query("SELECT is_private FROM users WHERE id=3")).rows[0].is_private,true);
  } finally { await db.close(); }
});

test('legacy SQL toggles preserve actual private, block and age read gates', { timeout: 120000 }, async () => {
  const db = await fixture();
  const expected = ids => ({ posts: ids, media: ids, slides: ids, comments: ids });
  const mutate = async (actor, target, action = 'toggle') => {
    await db.exec('SET ROLE service_role');
    try {
      return (await db.query('SELECT mutate_follow_relationship($1,$2,$3) AS result', [actor, target, action])).rows[0].result;
    } finally { await db.exec('RESET ROLE'); }
  };
  try {
    await activate(db);
    await mutate(2, 1);
    assert.deepEqual(await visible(db, 'viewer'), expected([11, 12]));
    await mutate(2, 1);
    assert.deepEqual(await visible(db, 'viewer'), expected([12]));

    assert.equal((await mutate(2, 3)).followRequestStatus, 'pending');
    assert.deepEqual(await visible(db, 'viewer'), expected([12]));
    await mutate(6, 2, 'approve');
    await mutate(2, 3, 'approve');
    assert.deepEqual(await visible(db, 'viewer'), expected([12]), 'neither stranger nor requester can approve');
    await mutate(3, 2, 'approve');
    assert.deepEqual(await visible(db, 'viewer'), expected([12, 31, 32]));
    await mutate(2, 3);
    await mutate(3, 2, 'approve');
    assert.deepEqual(await visible(db, 'viewer'), expected([12]), 'cancelled approval cannot resurrect access');

    for (const [blocker, blocked] of [[1, 2], [2, 1]]) {
      await db.exec(`INSERT INTO blocks VALUES(${blocker},${blocked})`);
      await mutate(2, 1);
      assert.deepEqual(await visible(db, 'viewer'), expected([]), 'legacy follow never overrides either direction of block');
      await mutate(2, 1);
      await db.exec('DELETE FROM blocks');
    }

    await mutate(5, 1);
    assert.deepEqual(await visible(db, 'minor'), expected([12]), 'legacy public follows preserve age restriction');
    await mutate(5, 3);
    await mutate(3, 5, 'approve');
    assert.deepEqual(await visible(db, 'minor'), expected([12, 32]), 'even owner approval never overrides the spicy age restriction');
  } finally { await db.close(); }
});

test('read gate refuses mutable identity mappings atomically', { timeout: 120000 }, async () => {
  const db = await fixture();
  try {
    await db.exec('GRANT UPDATE(auth_id) ON users TO authenticated');
    await assert.rejects(db.exec(gate), /Trusted users identity column prerequisite/);
    await db.exec('ROLLBACK');
    assert.equal((await db.query("SELECT to_regprocedure('public.post_follow_hidden(bigint)')::text AS fn")).rows[0].fn, null);
    assert.equal((await db.query("SELECT has_table_privilege('authenticated','user_settings','UPDATE') AS allowed")).rows[0].allowed, true, 'failed migration makes no partial permission change');
  } finally { await db.close(); }
});

test('actual identity prerequisite composes with private post approvals and optional notification RLS', { timeout: 120000 }, async () => {
  const db = await fixture();
  const identity = fs.readFileSync(path.join(__dirname, '../docs/security/users-identity-write-prerequisite.sql'), 'utf8');
  const notifications = fs.readFileSync(path.join(__dirname, '../docs/security/notification-privacy-draft.sql'), 'utf8');
  async function as(role, subject, run) {
    await db.query("SELECT set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: subject })]);
    await db.exec(`SET ROLE ${role}`);
    try { return await run(); } finally { await db.exec('RESET ROLE'); }
  }
  try {
    // Reproduce only the observed privilege shape using synthetic identities.
    await db.exec(`GRANT USAGE,SELECT ON SEQUENCE user_settings_id_seq TO service_role;
      ALTER TABLE users ENABLE ROW LEVEL SECURITY;
      CREATE POLICY profile_reads ON users FOR SELECT TO public USING(true);
      CREATE POLICY profile_updates ON users FOR UPDATE TO public USING(true);
      CREATE POLICY profile_inserts ON users FOR INSERT TO public WITH CHECK(true);
      GRANT INSERT,UPDATE,DELETE ON users TO anon,authenticated;
      GRANT UPDATE(auth_id,id,is_private) ON users TO PUBLIC;`);
    await assert.rejects(db.exec(gate), /Trusted users identity (column )?prerequisite/);
    await db.exec('ROLLBACK');
    await db.exec(identity); await db.exec(identity);
    for (const role of ['anon', 'authenticated']) await as(role, 'viewer', async () => {
      assert.equal((await db.query('SELECT id FROM users')).rows.length, 7);
      for (const sql of ["UPDATE users SET auth_id='forged' WHERE id=3", 'UPDATE users SET is_private=false WHERE id=3',
        "INSERT INTO users(id,auth_id,is_private) VALUES(99,'forged',false)", 'DELETE FROM users WHERE id=3']) {
        await assert.rejects(db.exec(sql), error => error.code === '42501');
      }
    });
    await activate(db); await activate(db);
    const expected = ids => ({ posts: ids, media: ids, slides: ids, comments: ids });
    assert.deepEqual(await visible(db, 'viewer'), expected([12]));
    const mutate = (actor, target, action) => as('service_role', '', async () =>
      (await db.query('SELECT mutate_follow_relationship($1,$2,$3) AS result', [actor,target,action])).rows[0].result);
    assert.equal((await mutate(2,3,'follow')).followRequestStatus, 'pending');
    assert.deepEqual(await visible(db, 'viewer'), expected([12]));
    await mutate(3,2,'approve');
    assert.deepEqual(await visible(db, 'viewer'), expected([12,31,32]));
    await mutate(2,3,'unfollow');
    assert.deepEqual(await visible(db, 'viewer'), expected([12]));
    await as('service_role', '', async () => {
      await db.exec("INSERT INTO users(id,auth_id,is_private) VALUES(99,'new-service-profile',false)");
      await db.exec("INSERT INTO user_settings(auth_id,settings) VALUES('author-private','{\"privacy\":{\"privateAccount\":false}}')");
      assert.equal((await db.query('SELECT is_private FROM users WHERE id=3')).rows[0].is_private, false);
    });
    assert.deepEqual(await visible(db, 'viewer'), expected([12,32]), 'service settings trigger survives identity lockdown');
    // Weekly protections already work above, before notification SQL is applied.
    await db.exec(`CREATE TABLE notifications(id serial PRIMARY KEY,recipient_id integer REFERENCES users,
      read_at timestamptz,entity_payload jsonb);
      INSERT INTO notifications(recipient_id,entity_payload) VALUES(2,'{"body":"viewer-only"}'),(3,'{"body":"author-only"}');
      ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
      GRANT SELECT,INSERT,UPDATE ON notifications TO anon,authenticated;
      GRANT ALL ON notifications TO service_role;
      GRANT USAGE,SELECT ON SEQUENCE notifications_id_seq TO anon,authenticated,service_role;
      CREATE POLICY old_notice_read ON notifications FOR SELECT USING(true);
      CREATE POLICY old_notice_update ON notifications FOR UPDATE USING(true);
      CREATE POLICY old_notice_insert ON notifications FOR INSERT WITH CHECK(true);`);
    await db.exec(notifications); await db.exec(notifications);
    await as('authenticated', 'viewer', async () => {
      assert.deepEqual((await db.query('SELECT recipient_id FROM notifications')).rows, [{ recipient_id: 2 }]);
      assert.equal((await db.query('UPDATE notifications SET read_at=now() WHERE recipient_id=3 RETURNING id')).rows.length, 0);
      assert.equal((await db.query('UPDATE notifications SET read_at=now() WHERE recipient_id=2 RETURNING id')).rows.length, 1);
      await assert.rejects(db.exec("UPDATE notifications SET entity_payload='{}' WHERE recipient_id=2"), error => error.code === '42501');
    });
    await as('anon', '', () => assert.rejects(db.exec('SELECT * FROM notifications'), error => error.code === '42501'));
    assert.deepEqual(await visible(db, 'viewer'), expected([12,32]));
  } finally { await db.close(); }
});


test('preserved relationship status, one-snapshot service projection, RLS and child gates agree', async () => {
 const db=await fixture(true); const expected=ids=>({posts:ids,media:ids,slides:ids,comments:ids});
 try {
  await activate(db);
  assert.deepEqual(await visible(db,'viewer'),expected([11,12,31,32,41,42]));
  assert.deepEqual(await visible(db,'minor'),expected([12,32]),'legacy never bypasses existing age gate');
  const relation=async()=> (await db.query('SELECT * FROM post_relationship_access(2,ARRAY[1,3,4]::bigint[]) ORDER BY author_id')).rows;
  assert.ok((await relation()).every(x=>x.is_following && !x.is_blocked));
  await db.exec('UPDATE users SET is_private=true WHERE id=1');
  assert.deepEqual(await visible(db,'viewer'),expected([11,12,31,32,41,42]));
  assert.equal((await db.query("SELECT (mutate_follow_relationship(2,1,'status')->>'following')::boolean f")).rows[0].f,true);
  for(const pair of ['1,2','2,1']) {
   await db.exec(`INSERT INTO blocks VALUES(${pair})`);
   assert.equal((await relation())[0].is_blocked,true);
   assert.deepEqual(await visible(db,'viewer'),expected([31,32,41,42]));
   await db.exec('DELETE FROM blocks');
  }
  await db.exec('DELETE FROM follows WHERE follower_id=2 AND following_id=1; INSERT INTO follows(follower_id,following_id) VALUES(2,1)');
  assert.equal((await relation())[0].is_following,false);
  assert.deepEqual(await visible(db,'viewer'),expected([31,32,41,42]));
 }finally{await db.close();}
});
