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

test('catalogue mirrors protected posts without exposing source, motion or thumbnails', async()=> {
 const db=await fixture(); try {
  await activate(db);
  await db.exec(`ALTER TABLE posts ADD COLUMN visibility text DEFAULT 'public';
   ALTER TABLE posts_media ADD COLUMN live_photo_video_url text;
   ALTER TABLE posts_media ADD COLUMN thumbnail text;
   CREATE TABLE media(id bigint PRIMARY KEY,url text);
   ALTER TABLE media ENABLE ROW LEVEL SECURITY;
   GRANT SELECT ON media TO anon,authenticated,service_role;
   CREATE POLICY media_select ON media FOR SELECT TO public USING(true);
   INSERT INTO media SELECT id,url FROM posts_media;
   UPDATE posts_media SET live_photo_video_url='https://fixture.invalid/motion',thumbnail='https://fixture.invalid/thumb' WHERE id=31;
   INSERT INTO media VALUES(101,'https://fixture.invalid/motion'),(102,'https://fixture.invalid/thumb?width=256'),(103,'https://fixture.invalid/public-avatar');
   ALTER TABLE media ADD COLUMN filename text;
   CREATE TABLE live_photo_upload_receipts(media_id bigint,url text,object_key text,owner_auth_id text);
   INSERT INTO media(id,url,filename) VALUES(104,'https://fixture.invalid/post-image/owner/new.jpg','post-image/owner/new.jpg');
   INSERT INTO live_photo_upload_receipts VALUES(104,'https://fixture.invalid/post-image/owner/new.jpg','post-image/owner/new.jpg','author-private');`);
  async function catalogue(subject, role='authenticated') {
   await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,...(subject?{sub:subject}:{})})]);
   await db.exec(`SET ROLE ${role}`);
   try {return (await db.query('SELECT id FROM media ORDER BY id')).rows.map(r=>Number(r.id));} finally {await db.exec('RESET ROLE')}
  }
  assert.ok((await catalogue(null,'anon')).includes(31),'reproduces pre-fix catalogue leak');
  const sql=fs.readFileSync(path.join(migrations,'20261111040000_protected_post_media_catalogue.sql'),'utf8');
  await db.exec(sql);await db.exec(sql);
  assert.deepEqual(await catalogue(null,'anon'),[12,103]);
  assert.deepEqual(await catalogue('viewer'),[12,103]);
  assert.ok((await catalogue('author-private')).includes(31),'owner retains access');
  assert.ok((await catalogue('author-private')).includes(101),'owner motion access');
  assert.ok((await catalogue('author-private')).includes(104),'uploader retains unlinked access');
  assert.equal((await catalogue('viewer')).includes(104),false,'fresh unlinked post upload hidden');
  await db.query("SELECT mutate_follow_relationship(2,3,'follow')");
  assert.deepEqual(await catalogue('viewer'),[12,103],'pending remains locked');
  await db.query("SELECT mutate_follow_relationship(3,2,'approve')");
  assert.deepEqual(await catalogue('viewer'),[12,31,32,101,102,103],'approved follower gains access');
  await db.query("SELECT mutate_follow_relationship(5,3,'follow')");
  await db.query("SELECT mutate_follow_relationship(3,5,'approve')");
  assert.deepEqual(await catalogue('minor'),[12,32,103],'approved minor still cannot see spicy source or derivatives');
  assert.ok((await catalogue(null,'service_role')).includes(31),'service retains catalogue access');
  await db.exec('INSERT INTO blocks VALUES(3,2)');
  assert.deepEqual(await catalogue('viewer'),[12,103],'block revokes catalogue');
  await db.exec('DELETE FROM blocks');
  await db.query("SELECT mutate_follow_relationship(2,3,'unfollow')");
  assert.deepEqual(await catalogue('viewer'),[12,103],'unfollow revokes catalogue');
  await db.exec("UPDATE posts SET visibility='private' WHERE id=12");
  assert.deepEqual(await catalogue(null,'anon'),[103],'nonpublic safe post is hidden');
  assert.ok((await catalogue('author-public')).includes(12),'nonpublic owner remains allowed');
  await db.exec("UPDATE posts_media SET url='https://fixture.invalid/public-avatar' WHERE id=31");
  assert.equal((await catalogue(null,'anon')).includes(103),false,'reuse on private post fails closed');
 } finally {await db.close();}
});
