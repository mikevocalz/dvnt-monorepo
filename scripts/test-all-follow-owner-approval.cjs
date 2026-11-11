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


const approvalSql=fs.readFileSync(path.join(migrations,'20261111201000_all_follow_owner_approval.sql'),'utf8');
async function allApproval(db) {
 await db.exec(`ALTER TABLE users ADD COLUMN username text;
 CREATE TYPE enum_notifications_type AS ENUM ('system','follow','follow_request','follow_request_approved');
 CREATE TABLE notifications(id serial PRIMARY KEY,recipient_id bigint,actor_id bigint,type enum_notifications_type,entity_type text,entity_id text,entity_payload jsonb);`);
 await db.exec(fs.readFileSync(path.join(migrations,'20261110010100_follow_request_notifications.sql'),'utf8'));
 await db.exec(approvalSql);await db.exec(approvalSql);
}
const call=async(db,a,b,action)=>(await db.query('SELECT mutate_follow_relationship($1,$2,$3) r',[a,b,action])).rows[0].r;
test('new public follow stays pending until owner approves; public safe stays visible',async()=>{
 const db=await fixture();try{
  await activate(db);await allApproval(db);
  const before=await visible(db,'viewer');assert.deepEqual(before.posts,[12]);
  const request=await call(db,2,1,'follow');assert.equal(request.following,false);assert.equal(request.followRequestStatus,'pending');assert.equal(request.notifyRequest,true);
  assert.deepEqual((await visible(db,'viewer')).posts,[12]);
  assert.equal((await db.query('SELECT count(*)::int n FROM follows')).rows[0].n,0);
  assert.equal((await call(db,2,1,'follow')).notifyRequest,false);
  assert.equal((await db.query('SELECT count(*)::int n FROM notifications')).rows[0].n,1);
  await call(db,6,2,'approve');assert.equal((await call(db,2,1,'status')).following,false,'unrelated owner cannot approve');
  await call(db,1,2,'approve');assert.equal((await call(db,2,1,'status')).following,true);
  assert.deepEqual((await visible(db,'viewer')).posts,[11,12]);
  await call(db,1,2,'approve');assert.equal((await db.query('SELECT count(*)::int n FROM notifications')).rows[0].n,1,'approval notification deduplicated');
  await call(db,2,1,'unfollow');assert.deepEqual((await visible(db,'viewer')).posts,[12]);
  assert.equal((await call(db,2,1,'follow')).followRequestStatus,'pending','refollow needs new approval');
  await call(db,1,2,'decline');assert.equal((await call(db,2,1,'status')).followRequestStatus,'none');
 }finally{await db.close()}
});
test('legacy public follows preserved; direct inserts cannot bypass approval; age and private gates hold',async()=>{
 const db=await fixture(true);try{
  await activate(db);const before=await visible(db,'viewer');await allApproval(db);
  assert.deepEqual(await visible(db,'viewer'),before,'no retroactive follower revocation');
  assert.equal((await call(db,2,1,'follow')).following,true);
  await db.exec('INSERT INTO follows(follower_id,following_id) VALUES(6,1)');
  assert.equal((await call(db,6,1,'status')).followRequestStatus,'pending');assert.deepEqual((await visible(db,'stranger')).posts,[12]);
  await call(db,6,1,'toggle');assert.equal((await call(db,6,1,'status')).followRequestStatus,'none');
  await call(db,6,1,'toggle');assert.equal((await call(db,6,1,'status')).followRequestStatus,'pending');
  await call(db,1,6,'approve');assert.deepEqual((await visible(db,'stranger')).posts,[11,12]);
  await call(db,5,1,'unfollow');await call(db,5,1,'follow');await call(db,1,5,'approve');
  assert.equal((await visible(db,'minor')).posts.includes(11),false,'approval never bypasses minor exclusion');
  await call(db,6,3,'follow');assert.equal((await visible(db,'stranger')).posts.includes(32),false);
  await call(db,3,6,'approve');assert.equal((await visible(db,'stranger')).posts.includes(32),true);
  await db.exec('INSERT INTO blocks VALUES(1,6)');assert.equal((await visible(db,'stranger')).posts.includes(11),false);
 }finally{await db.close()}
});
