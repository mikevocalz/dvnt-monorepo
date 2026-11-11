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
    -- Actual production post-comment columns; event comments live separately.
    CREATE TABLE comments(id integer PRIMARY KEY,author_id integer,post_id integer,
      content varchar,created_at timestamptz,updated_at timestamptz,parent_id integer,
      likes_count integer,client_mutation_id text,root_id bigint,depth smallint,attachment jsonb);
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
    INSERT INTO comments(id,post_id,content) SELECT id,id,'comment secret '||id FROM posts;
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

test('raw engagement cannot enumerate protected posts or forge another member',async()=>{
 const db=await fixture();try {
  await activate(db);
  await db.exec(`ALTER TABLE posts ADD COLUMN visibility text DEFAULT 'public';
   CREATE TABLE event_comments(id integer PRIMARY KEY,event_id integer,content text);
   INSERT INTO event_comments VALUES(31,90,'collision with private post comment'),
     (100,90,'collision with parentless post comment'),(102,90,'event-only comment');
   INSERT INTO comments(id,post_id,content) VALUES(100,NULL,'parentless'),(101,999,'missing post');
   CREATE TABLE likes(id serial PRIMARY KEY,post_id bigint,user_id integer);
   CREATE TABLE comment_likes(id serial PRIMARY KEY,comment_id bigint,user_id integer);
   ALTER TABLE likes ENABLE ROW LEVEL SECURITY;ALTER TABLE comment_likes ENABLE ROW LEVEL SECURITY;
   CREATE POLICY old_read ON likes FOR SELECT USING(true);
   CREATE POLICY old_insert ON likes FOR INSERT WITH CHECK(true);
   CREATE POLICY old_delete ON likes FOR DELETE USING(true);
   CREATE POLICY old_read ON comment_likes FOR SELECT USING(true);
   CREATE POLICY old_insert ON comment_likes FOR INSERT WITH CHECK(true);
   CREATE POLICY old_delete ON comment_likes FOR DELETE USING(true);
   GRANT SELECT,INSERT,UPDATE,DELETE ON likes,comment_likes TO anon,authenticated,service_role;
   GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO anon,authenticated,service_role;
   INSERT INTO likes(post_id,user_id) VALUES(31,3),(12,1),(999,1);
   INSERT INTO comment_likes(comment_id,user_id) VALUES(31,3),(12,1),(100,1),(101,1);`);
  async function as(subject,fn,role='authenticated'){
   await db.query("SELECT set_config('request.jwt.claims',$1,false)",[JSON.stringify({role,...(subject?{sub:subject}:{})})]);
   await db.exec(`SET ROLE ${role}`);try{return await fn()}finally{await db.exec('RESET ROLE')}
  }
  const ids=async table=>(await db.query(`SELECT id FROM ${table} ORDER BY id`)).rows.map(r=>r.id);
  assert.deepEqual(await as(null,()=>ids('likes'),'anon'),[1,2,3],'pre-fix anonymous leak');
  const sql=fs.readFileSync(path.join(migrations,'20261111042000_protected_post_engagement.sql'),'utf8');
  await db.exec(sql);await db.exec(sql);
  assert.deepEqual(await as(null,()=>ids('likes'),'anon'),[2]);
  assert.deepEqual(await as(null,()=>ids('comment_likes'),'anon'),[2],'only visible post comments; null/missing parents and event collisions hidden');
  await as(null,()=>assert.rejects(()=>db.query('INSERT INTO likes(post_id,user_id) VALUES(12,1)'),e=>e.code==='42501'),'anon');
  await as('viewer',()=>assert.rejects(()=>db.query('INSERT INTO likes(post_id,user_id) VALUES(12,1)'),e=>e.code==='42501'));
  await as('viewer',()=>assert.rejects(()=>db.query('INSERT INTO likes(post_id,user_id) VALUES(31,2)'),e=>e.code==='42501'));
  await as('viewer',()=>db.query('DELETE FROM likes WHERE user_id=3'));
  assert.equal((await db.query('SELECT count(*)::int n FROM likes WHERE user_id=3')).rows[0].n,1,'cannot delete victim');
  await db.query("SELECT mutate_follow_relationship(2,3,'follow')");
  assert.deepEqual(await as('viewer',()=>ids('likes')),[2],'pending hides other liker');
  await db.query("SELECT mutate_follow_relationship(3,2,'approve')");
  assert.deepEqual(await as('viewer',()=>ids('likes')),[1,2]);
  await as('viewer',()=>db.query('INSERT INTO likes(post_id,user_id) VALUES(31,2)'));
  await as('viewer',()=>db.query('INSERT INTO comment_likes(comment_id,user_id) VALUES(31,2)'));
  await db.query("SELECT mutate_follow_relationship(2,3,'unfollow')");
  const own=(await db.query('SELECT id FROM likes WHERE user_id=2')).rows[0].id;
  assert.deepEqual(await as('viewer',()=>ids('likes')),[2,own],'only own revoked engagement survives for deletion');
  await as('viewer',()=>db.query('DELETE FROM likes WHERE post_id=31 AND user_id=2'));
  await as('viewer',()=>db.query('DELETE FROM comment_likes WHERE comment_id=31 AND user_id=2'));
  assert.equal((await db.query('SELECT count(*)::int n FROM likes WHERE user_id=2')).rows[0].n,0,'actual delete works after revoke');
  assert.equal((await db.query('SELECT count(*)::int n FROM comment_likes WHERE user_id=2')).rows[0].n,0);
  await as('viewer',()=>assert.rejects(()=>db.query('INSERT INTO comment_likes(comment_id,user_id) VALUES(100,1)'),e=>e.code==='42501'));
  for (const commentId of [100,101,102,999]) {
   assert.equal((await as('viewer',()=>db.query('SELECT engagement_comment_visible($1) AS visible',[commentId]))).rows[0].visible,false);
   await as('viewer',()=>assert.rejects(()=>db.query('INSERT INTO comment_likes(comment_id,user_id) VALUES($1,2)',[commentId]),e=>e.code==='42501'));
  }
  assert.equal((await db.query('SELECT count(*)::int n FROM event_comments')).rows[0].n,3,'separate event comments untouched');
  await db.exec('CREATE POLICY future_update ON likes FOR UPDATE USING(true) WITH CHECK(true);CREATE POLICY future_update ON comment_likes FOR UPDATE USING(true) WITH CHECK(true)');
  await as('author-public',()=>db.query('UPDATE likes SET user_id=2 WHERE post_id=12'));
  await as('author-public',()=>db.query('UPDATE comment_likes SET user_id=2 WHERE comment_id=12'));
  assert.equal((await db.query('SELECT user_id FROM likes WHERE post_id=12')).rows[0].user_id,1,'raw UPDATE cannot reassign a like');
  assert.equal((await db.query('SELECT user_id FROM comment_likes WHERE comment_id=12')).rows[0].user_id,1);
  await as(null,()=>db.query('INSERT INTO likes(post_id,user_id) VALUES(31,2)'),'service_role');
 }finally{await db.close()}
});
