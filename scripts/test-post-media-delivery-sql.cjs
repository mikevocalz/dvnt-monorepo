const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {PGlite}=require('@electric-sql/pglite');
const sql=fs.readFileSync(__dirname+'/../apps/mobile/supabase/migrations/20261111024044_post_media_delivery_parents.sql','utf8');
test('service-only delivery parent query includes all duplicate variants and orphans, bounded and read-only',async()=>{
 const db=new PGlite();try{
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE posts(id bigint PRIMARY KEY,author_id bigint,visibility text,is_nsfw boolean);
 CREATE TABLE posts_media(_parent_id bigint,url text,thumbnail text,live_photo_video_url text);
 INSERT INTO posts VALUES(1,10,'public',false),(2,20,'private',true),(3,30,'public',false),(4,40,'private',false),(5,50,'private',false);
 INSERT INTO posts_media VALUES(1,'https://cdn.test/post-image/a',null,null),(2,'https://cdn.test/post-image/a?transform=1',null,null),
 (4,'https://CDN.TEST:443/post-image/a',null,null),(5,'https://alias.test/%70ost-image/x/../%61',null,null),(3,null,'https://cdn.test/post-image/a#thumb',null),(999,null,null,'https://cdn.test/post-image/a');
 GRANT SELECT ON posts,posts_media TO service_role;`);
 await db.exec(sql);
 for(const role of ['anon','authenticated']){await db.exec('SET ROLE '+role);await assert.rejects(db.query("SELECT * FROM post_media_delivery_parents(ARRAY['https://cdn.test/post-image/a'])"),/permission denied/);await db.exec('RESET ROLE')}
 await db.exec('SET ROLE service_role');
 const rows=(await db.query("SELECT * FROM post_media_delivery_parents(ARRAY['https://cdn.test/post-image/a']) ORDER BY id")).rows;
 assert.deepEqual(rows.map(r=>Number(r.id)),[1,2,3,4,5,999]);assert.equal(rows[5].author_id,null);
 for(const value of ['https://CDN.TEST:443/post-image/a','https://alias.test/%2570ost-image/x/../%61','//cdn.test/post-image//a','/post-image/./a','https:////cdn.test/post-image/a','https:/cdn.test/post-image/a','https:cdn.test/post-image/a',' https://cdn.test/post-image/a ','https://cdn.test/post-image%5ca','https://cdn.test'+String.fromCharCode(92)+'post-image'+String.fromCharCode(92)+'a'])assert.equal((await db.query('SELECT post_media_delivery_path($1) p',[value])).rows[0].p,'/post-image/a');
 assert.equal((await db.query("SELECT * FROM post_media_delivery_parents(ARRAY[]::text[])")).rows.length,0);
 assert.equal((await db.query("SELECT * FROM post_media_delivery_parents(array_fill('x'::text,ARRAY[61]))")).rows.length,0);
 await assert.rejects(db.exec('DELETE FROM posts'),/permission denied/);
 await db.exec('RESET ROLE');
 const meta=(await db.query("SELECT prosecdef,provolatile,proconfig FROM pg_proc WHERE proname='post_media_delivery_parents'")).rows[0];
 assert.equal(meta.prosecdef,false);assert.equal(meta.provolatile,'s');assert.ok(meta.proconfig.some(s=>s.startsWith('search_path=')));
 await db.exec("INSERT INTO posts_media SELECT n,'https://cdn.test/post-image/a',null,null FROM generate_series(1000,1300)n");
 await db.exec('SET ROLE service_role');assert.equal((await db.query("SELECT * FROM post_media_delivery_parents(ARRAY['https://cdn.test/post-image/a'])")).rows.length,257);
 }finally{await db.close()}
});
