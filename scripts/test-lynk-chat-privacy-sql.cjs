const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const root=require('node:path').resolve(__dirname,'..');
const migrations=['20261003150200_video_room_members_user_id_private.sql','20261027214500_lynk_chat_author_privacy_repair.sql'].map(n=>readFileSync(root+'/apps/mobile/supabase/migrations/'+n,'utf8'));
const room='00000000-0000-4000-8000-000000000001';
const schema=`
CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;
CREATE SCHEMA auth; GRANT USAGE ON SCHEMA auth TO anon,authenticated,service_role;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT COALESCE(NULLIF(current_setting('request.jwt.claims',true),''),'{}')::jsonb $$;
CREATE TABLE video_rooms(id integer PRIMARY KEY, uuid uuid NOT NULL UNIQUE,created_by text);
CREATE TABLE video_room_members(id serial PRIMARY KEY,room_id integer REFERENCES video_rooms(id),user_id text,role varchar,status varchar,joined_at timestamptz,left_at timestamptz,created_at timestamptz,hand_raised boolean,is_anonymous boolean,anon_label text,last_seen_at timestamptz);
CREATE TABLE room_comments(id bigserial PRIMARY KEY,room_id text NOT NULL,author_id text NOT NULL,body text NOT NULL,parent_id bigint,root_id bigint,depth smallint NOT NULL DEFAULT 0,mentions jsonb DEFAULT '[]',created_at timestamptz NOT NULL DEFAULT now());
CREATE FUNCTION viewer_in_lynk_room(p_room_id integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT auth.jwt()->>'role'='service_role' OR EXISTS(SELECT 1 FROM video_room_members WHERE room_id=p_room_id AND user_id=auth.jwt()->>'sub') $$;
CREATE FUNCTION viewer_hosts_lynk_room(p_room_id integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$ SELECT auth.jwt()->>'role'='service_role' OR EXISTS(SELECT 1 FROM video_rooms WHERE id=p_room_id AND created_by=auth.jwt()->>'sub') $$;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role; GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT SELECT ON video_rooms,video_room_members TO authenticated;
GRANT SELECT,INSERT ON room_comments TO anon,authenticated;
GRANT USAGE,SELECT ON room_comments_id_seq TO anon,authenticated;
ALTER TABLE video_room_members ENABLE ROW LEVEL SECURITY;
CREATE POLICY video_room_members_select_participant ON video_room_members FOR SELECT TO authenticated USING(user_id=auth.jwt()->>'sub' OR viewer_in_lynk_room(room_id) OR viewer_hosts_lynk_room(room_id));
ALTER TABLE room_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY room_comments_select ON room_comments FOR SELECT USING(true);
CREATE POLICY room_comments_insert ON room_comments FOR INSERT WITH CHECK(true);
INSERT INTO video_rooms VALUES(1,'${room}','fixture-host');
INSERT INTO video_room_members(id,room_id,user_id,role,status,is_anonymous) VALUES(1,1,'fixture-host','host','active',false),(2,1,'fixture-private','participant','active',true),(3,1,'fixture-member','participant','active',false),(4,1,'fixture-left','participant','left',false);
INSERT INTO room_comments(room_id,author_id,body) VALUES('${room}','fixture-private','anonymous'),('${room}','fixture-member','named'),('${room}','fixture-missing','historical');
`;
async function setup(){const db=new PGlite();await db.exec(schema);return db;}
async function as(db,role,sub,sql){await db.exec(`SET ROLE ${role}; SELECT set_config('request.jwt.claims','${JSON.stringify({role,sub})}',false)`); try{return (await db.query(sql)).rows;} finally{await db.exec('RESET ROLE');}}
async function denied(db,role,sub,sql){await assert.rejects(()=>as(db,role,sub,sql),e=>e.code==='42501');}
test('real migrations preserve room reads and edge writes while masking anonymous identities',async()=>{const db=await setup();try{
 for(const m of migrations)await db.exec(m);
 assert.deepEqual((await db.query('SELECT author_handle FROM room_comments ORDER BY id')).rows.map(r=>r.author_handle),['member:2','fixture-member','legacy-comment:3']);
 assert.equal((await db.query("SELECT is_nullable FROM information_schema.columns WHERE table_name='room_comments' AND column_name='author_handle'")).rows[0].is_nullable,'NO');
 for(const sub of ['fixture-host','fixture-member','fixture-private','fixture-left']){
  assert.equal((await as(db,'authenticated',sub,'SELECT id,room_id,role,status,joined_at,left_at FROM video_room_members')).length,4);
  assert.equal((await as(db,'authenticated',sub,'SELECT room_id FROM video_room_members')).length,4);
  assert.equal((await as(db,'authenticated',sub,'SELECT id,room_id,author_handle,body,parent_id,root_id,depth,mentions,created_at FROM room_comments')).length,3);
  const roster=await as(db,'authenticated',sub,'SELECT * FROM lynk_room_roster(1)');
  assert.equal(roster[1].user_id,sub==='fixture-private'?'fixture-private':'member:2');
  await denied(db,'authenticated',sub,'SELECT user_id FROM video_room_members');
  await denied(db,'authenticated',sub,"SELECT id FROM video_room_members WHERE user_id='fixture-private'");
  await denied(db,'authenticated',sub,'SELECT author_id FROM room_comments');
 }
 assert.equal((await as(db,'authenticated','fixture-outsider','SELECT author_handle FROM room_comments')).length,0);
 assert.equal((await as(db,'authenticated','fixture-outsider','SELECT * FROM lynk_room_roster(1)')).length,0);
 await denied(db,'anon','', 'SELECT author_handle FROM room_comments');
 await denied(db,'authenticated','fixture-member',`INSERT INTO room_comments(room_id,author_id,body) VALUES('${room}','fixture-private','spoof')`);
 await denied(db,'authenticated','fixture-member',`SELECT room_comment_author_handle('${room}','fixture-private')`);
 await denied(db,'service_role','',`INSERT INTO room_comments(room_id,author_id,body) VALUES('${room}','fixture-outsider','unmatched must fail')`);
 const inserted=await as(db,'service_role','',`INSERT INTO room_comments(room_id,author_id,body) VALUES('${room}','fixture-private','service insert') RETURNING id,author_handle,body`);
 assert.equal(inserted[0].author_handle,'member:2');
 assert.equal((await as(db,'service_role','',"SELECT user_id FROM video_room_members WHERE user_id='fixture-private'")).length,1);
 await as(db,'service_role','',`UPDATE room_comments SET author_id='fixture-member' WHERE id=${inserted[0].id}`);
 assert.equal((await db.query(`SELECT author_handle FROM room_comments WHERE id=${inserted[0].id}`)).rows[0].author_handle,'fixture-member');
 await as(db,'service_role','',`DELETE FROM room_comments WHERE id=${inserted[0].id}`);
 for(const m of migrations)await db.exec(m);
 assert.equal((await db.query('SELECT count(*)::int n FROM room_comments')).rows[0].n,3);
}finally{await db.close();}});
test('a precommit validation error rolls back chat schema, backfill, trigger and grants atomically',async()=>{const db=await setup();try{
 await db.exec(migrations[0]);
 await assert.rejects(()=>db.exec(migrations[1].replace(/commit;\s*$/i,'SELECT 1/0; COMMIT;')));
 await db.exec('ROLLBACK');
 assert.equal((await db.query("SELECT count(*)::int n FROM information_schema.columns WHERE table_name='room_comments' AND column_name='author_handle'")).rows[0].n,0);
 assert.equal((await db.query("SELECT count(*)::int n FROM pg_trigger WHERE tgrelid='room_comments'::regclass AND NOT tgisinternal")).rows[0].n,0);
 assert.equal((await as(db,'anon','','SELECT author_id FROM room_comments')).length,3);
}finally{await db.close();}});


test('repair also upgrades an already-applied old migration and replaces unsafe unmatched handles',async()=>{const db=await setup();try{
 await db.exec(migrations[0]);
 await db.exec(readFileSync(root+'/apps/mobile/supabase/migrations/20261003150300_room_comments_author_private.sql','utf8'));
 assert.equal((await db.query('SELECT author_handle FROM room_comments WHERE id=3')).rows[0].author_handle,'fixture-missing');
 await db.exec("UPDATE video_room_members SET is_anonymous=false WHERE id=2");
 await db.exec(migrations[1]);
 assert.equal((await db.query('SELECT author_handle FROM room_comments WHERE id=1')).rows[0].author_handle,'member:2','historical anonymity survives later named membership');
 assert.equal((await db.query('SELECT author_handle FROM room_comments WHERE id=3')).rows[0].author_handle,'legacy-comment:3');
 assert.equal((await db.query('SELECT count(*)::int n FROM room_comments')).rows[0].n,3);
}finally{await db.close();}});
