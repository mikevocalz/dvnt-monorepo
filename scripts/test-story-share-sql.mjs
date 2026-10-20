// Real checked-in migration + PostgreSQL/WASM transactions, entirely offline.
// NODE_PATH=/tmp/dvnt-story-test/node_modules node --test scripts/test-story-share-sql.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
const require = createRequire(import.meta.url);
const { PGlite } = require('@electric-sql/pglite');
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migration = readFileSync(resolve(root, 'apps/mobile/supabase/migrations/20261020221500_story_share_attribution.sql'), 'utf8');
const uuid = n => `00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
async function fixture() {
  const db = new PGlite();
  await db.exec(readFileSync(resolve(root,'scripts/fixtures/story-share/schema.sql'),'utf8'));
  await db.exec(readFileSync(resolve(root,'apps/mobile/supabase/migrations/20261015033000_messages_operation_id.sql'),'utf8'));
  await db.exec(migration);
  return db;
}
async function share(db, {id=101,type='post',op=uuid(1),auth='fixture-sharer',viewer=null,visibility='public'}={}) {
  const {rows} = await db.query('SELECT publish_story_share($1,$2::uuid,$3,$4::bigint,$5,$6) AS value',[auth,op,type,id,visibility,viewer]);
  return rows[0].value;
}
async function counts(db) {
  return (await db.query(`SELECT (SELECT count(*)::int FROM stories) AS stories,(SELECT count(*)::int FROM messages) AS messages,(SELECT count(*)::int FROM media) AS media,(SELECT count(*)::int FROM conversations) AS conversations,(SELECT count(*)::int FROM story_share_requests) AS requests`)).rows[0];
}

test('migration reapplies; post and event persist canonical attribution and a single private author DM', async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    const post = await share(db);
    assert.equal(post.ok,true); assert.equal(post.story.authorId,'1');
    assert.deepEqual(post.story.sharedSource,{type:'post',id:'101',caption:'Canonical caption',author:{id:'2',username:'author',name:'Author',avatar:null}});
    assert.equal(post.story.mediaUrl,'https://fixture.invalid/post.jpg');
    assert.equal(post.notification.status,'sent');
    const event = await share(db,{type:'event',id:201,op:uuid(2)});
    assert.equal(event.story.sharedSource.author.id,'3'); assert.equal(event.story.sharedSource.title,'Canonical event');
    const {rows:messages} = await db.query('SELECT * FROM messages ORDER BY id');
    assert.equal(messages[0].sender_id,1);
    assert.equal(messages[0].content,'Shared your post to their story.');
    assert.deepEqual(messages[0].metadata,{type:'story_share',storyId:post.story.id,sourceType:'post',sourceId:'101'});
    assert.equal(messages[1].metadata.sourceTitle,'Canonical event');
    const members = (await db.query('SELECT users_id FROM conversations_rels WHERE parent_id=$1 ORDER BY users_id',[Number(event.notification.conversationId)])).rows.map(x=>x.users_id);
    assert.deepEqual(members,['fixture-host','fixture-sharer']);
    assert.deepEqual(await counts(db),{stories:2,messages:2,media:2,conversations:2,requests:2});
    const animated = await share(db,{id:105,op:uuid(3)});
    assert.equal(animated.story.mediaType,'video');
    assert.equal(animated.story.mediaUrl,'https://fixture.invalid/animated.mp4');
    assert.equal(animated.story.thumbnailUrl,'https://fixture.invalid/animated.jpg');
  } finally { await db.close(); }
});

test('same operation and concurrent queued retries return identical result; changed source or audience conflicts', async () => {
  const db = await fixture();
  try {
    const values = await Promise.all(Array.from({length:8},()=>share(db)));
    values.forEach(value=>assert.deepEqual(value,values[0]));
    assert.equal((await share(db,{id:103})).code,'idempotency_conflict');
    assert.equal((await share(db,{visibility:'followers'})).code,'idempotency_conflict');
    assert.deepEqual(await counts(db),{stories:1,messages:1,media:1,conversations:1,requests:1});
    await share(db,{id:103,op:uuid(2)});
    assert.equal((await counts(db)).conversations,1,'new share uses same existing two-person DM');
    assert.equal((await counts(db)).media,3,'video + canonical poster persisted');
    await db.exec("UPDATE users SET username='renamed-author' WHERE id=2");
    assert.equal((await share(db)).story.sharedSource.author.username,'renamed-author','replay routes to the current canonical handle');
    assert.equal((await counts(db)).messages,2);

  } finally { await db.close(); }
});

test('text posts/no-cover events need no invented media, self shares never open a DM', async () => {
  const db = await fixture();
  try {
    const text = await share(db,{id:104});
    assert.equal(text.story.sharedSource.caption,'First canonical text slide');
    assert.equal(text.story.mediaUrl,''); assert.equal(text.story.mediaType,'image');
    assert.equal((await db.query('SELECT media_id FROM stories WHERE id=$1',[Number(text.story.id)])).rows[0].media_id,null);
    const event = await share(db,{id:202,type:'event',op:uuid(2)});
    assert.equal(event.story.mediaUrl,'');
    const before = await counts(db);
    const own = await share(db,{id:102,op:uuid(3)});
    assert.equal(own.notification.status,'skipped_self');
    assert.equal((await counts(db)).messages,before.messages);
  } finally { await db.close(); }
});

test('privacy honors direct messages, requests and recipient follows, with explicit skip when both disabled', async () => {
  const db = await fixture();
  try {
    await db.exec(`UPDATE user_settings SET settings='{"messages":{"allowAll":false,"messageRequests":false}}' WHERE auth_id='fixture-author';`);
    assert.equal((await share(db)).notification.status,'skipped_privacy');
    assert.equal((await counts(db)).messages,0);
    await db.exec('INSERT INTO follows VALUES(2,1)');
    assert.equal((await share(db,{op:uuid(2)})).notification.status,'sent');
    await db.exec('DELETE FROM follows; DELETE FROM user_settings WHERE auth_id=\'fixture-author\'');
    assert.equal((await share(db,{op:uuid(3)})).notification.status,'sent','default messageRequests accepts a request');
  } finally { await db.close(); }
});

test('no publication or DM for unavailable/private/blocked/spicy/moderated/deleted sources or stale viewer', async () => {
  const db = await fixture();
  try {
    for (const args of [{id:999},{id:0},{id:-1},{type:'attendee'},{auth:'absent'},{viewer:'2'},{visibility:'private'}]) {
      assert.equal((await share(db,args)).ok,false,JSON.stringify(args));
    }
    const mutations = [
      "UPDATE posts SET visibility='private' WHERE id=101",
      "UPDATE posts SET visibility='followers' WHERE id=101",
      "UPDATE posts SET is_nsfw=true WHERE id=101",
      "UPDATE posts SET moderation_status='pending' WHERE id=101",
      "UPDATE posts SET moderation_status='rejected' WHERE id=101",
      "UPDATE posts SET deleted_at=now() WHERE id=101",
      "UPDATE posts SET is_hidden=true WHERE id=101",
      "UPDATE users SET is_private=true WHERE id=2",
      "UPDATE users SET banned_at=now() WHERE id=2",
      `UPDATE user_settings SET settings='{"privacy":{"privateAccount":true}}' WHERE auth_id='fixture-author'`,
      'INSERT INTO blocks VALUES(1,2)', 'INSERT INTO blocks VALUES(2,1)',
      'DELETE FROM posts WHERE id=101',
    ];
    for (const mutation of mutations) {
      await db.exec('BEGIN');
      await db.exec(mutation);
      assert.equal((await share(db)).code,'source_unavailable',mutation);
      assert.equal((await counts(db)).stories,0,mutation);
      await db.exec('ROLLBACK');
    }
    for (const mutation of ["visibility='private'","visibility='link_only'","status='cancelled'","status='draft'","is_hidden=true","publish_at=now()+interval '1 day'"]) {
      await db.exec('BEGIN'); await db.exec('UPDATE events SET '+mutation+' WHERE id=201');
      assert.equal((await share(db,{type:'event',id:201})).code,'source_unavailable',mutation);
      await db.exec('ROLLBACK');
    }
    assert.deepEqual(await counts(db),{stories:0,messages:0,media:0,conversations:0,requests:0});
  } finally { await db.close(); }
});

test('story, message and receipt failures rollback media, memberships and publication; retry succeeds once', async () => {
  const db = await fixture();
  try {
    for (const target of ['stories','messages','story_share_requests']) {
      await db.exec(`CREATE FUNCTION fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'synthetic failure'; END $$; CREATE TRIGGER fixture_fail BEFORE INSERT ON ${target} FOR EACH ROW EXECUTE FUNCTION fixture_fail();`);
      await assert.rejects(share(db),/synthetic failure/);
      assert.deepEqual(await counts(db),{stories:0,messages:0,media:0,conversations:0,requests:0},target);
      await db.exec(`DROP TRIGGER fixture_fail ON ${target}; DROP FUNCTION fixture_fail();`);
    }
    const retry = await share(db);
    assert.equal(retry.notification.status,'sent');
    assert.deepEqual(await share(db),retry);
    assert.deepEqual(await counts(db),{stories:1,messages:1,media:1,conversations:1,requests:1});
  } finally { await db.close(); }
});

test('ordinary-message operation collision does not recover/send a fake share or publish a story', async () => {
  const db = await fixture();
  try {
    await db.exec("INSERT INTO conversations VALUES(20,false,now()); INSERT INTO conversations_rels(parent_id,users_id,path) VALUES(20,'fixture-sharer','participants'),(20,'fixture-author','participants');");
    await db.query('INSERT INTO messages(conversation_id,sender_id,content,operation_id) VALUES(20,1,\'ordinary\',$1)',[uuid(1)]);
    assert.equal((await share(db)).code,'idempotency_conflict');
    assert.equal((await counts(db)).stories,0);
    assert.equal((await counts(db)).messages,1);
  } finally { await db.close(); }
});

test('malformed direct conversation with extra participant is never reused', async () => {
  const db = await fixture();
  try {
    await db.exec("INSERT INTO conversations VALUES(20,false,now()); INSERT INTO conversations_rels(parent_id,users_id,path) VALUES(20,'fixture-sharer','participants'),(20,'fixture-author','participants'),(20,'fixture-other','other');");
    const value = await share(db);
    assert.notEqual(value.notification.conversationId,'20');
    assert.equal((await db.query('SELECT count(*)::int AS n FROM messages WHERE conversation_id=20')).rows[0].n,0);
  } finally { await db.close(); }
});

test('service-only RPCs and reserved fields cannot be spoofed through permissive legacy REST grants', async () => {
  const db = await fixture();
  try {
    const created = await share(db);
    for (const role of ['anon','authenticated']) {
      await db.exec(`SET ROLE ${role};`);
      await assert.rejects(share(db,{op:uuid(2)}),/permission denied/);
      await assert.rejects(db.query('SELECT resolve_story_share_source(\'post\',101,\'fixture-sharer\')'),/permission denied/);
      await assert.rejects(db.query("INSERT INTO messages(conversation_id,sender_id,content,metadata) VALUES($1,1,'spoof',$2)",[Number(created.notification.conversationId),JSON.stringify({type:'story_share'})]),/server-owned/);
      await assert.rejects(db.query('UPDATE messages SET content=\'spoof\' WHERE id=$1',[Number(created.notification.messageId)]),/server-owned/);
      await assert.rejects(db.query("INSERT INTO stories(author_id,expires_at,shared_source) VALUES('fixture-sharer',now()+interval '1 day',$1)",[JSON.stringify(created.story.sharedSource)]),/server-owned/);
      await db.exec('RESET ROLE');
    }
    await db.exec("SET request.jwt.claims = '{\"sub\":\"fixture-sharer\"}'; SET ROLE authenticated;");
    await assert.rejects(db.query('UPDATE stories SET media_id=NULL WHERE id=$1',[Number(created.story.id)]),/server-owned/);
    await assert.rejects(db.query("UPDATE stories SET expires_at=now()+interval '10 years' WHERE id=$1",[Number(created.story.id)]),/server-owned/);
    await db.exec('RESET ROLE');
    await db.exec("GRANT SELECT,UPDATE,DELETE ON media TO authenticated; GRANT SELECT,INSERT,UPDATE,DELETE ON stories_stickers TO authenticated;");
    const mediaId=(await db.query('SELECT media_id FROM stories WHERE id=$1',[Number(created.story.id)])).rows[0].media_id;
    const ordinaryId=(await db.query("INSERT INTO stories(author_id,expires_at) VALUES('fixture-sharer',now()+interval '1 day') RETURNING id")).rows[0].id;
    await db.exec("UPDATE posts SET visibility='private' WHERE id=101; SET ROLE authenticated;");
    await db.query("INSERT INTO stories_stickers(id,_parent_id,type,data) VALUES('ordinary',$1,'text','{}')",[ordinaryId]);
    await db.exec("UPDATE stories_stickers SET data='{\"content\":\"ordinary edit\"}' WHERE id='ordinary'; DELETE FROM stories_stickers WHERE id='ordinary';");
    await assert.rejects(db.query("UPDATE media SET url='https://attacker.invalid/spoof.jpg' WHERE id=$1",[mediaId]),/server-owned/);
    await assert.rejects(db.query('DELETE FROM media WHERE id=$1',[mediaId]),/server-owned/);
    await assert.rejects(db.query("INSERT INTO stories_stickers(id,_parent_id,type,data) VALUES('forged',$1,'text','{}')",[Number(created.story.id)]),/server-owned/);
    await db.exec("RESET ROLE; UPDATE posts SET visibility='public' WHERE id=101;");
    await db.exec('SET ROLE service_role');
    assert.equal((await share(db,{op:uuid(2)})).ok,true);
    await db.exec('RESET ROLE');
  } finally { await db.close(); }
});

test('restrictive read boundary hides existing shares after source privacy/delete, source-author change or viewer block', async () => {
  const db = await fixture();
  try {
    await share(db);
    await db.exec("SET request.jwt.claims = '{\"sub\":\"fixture-sharer\"}'; SET ROLE authenticated;");
    assert.equal((await db.query('SELECT count(*)::int AS n FROM stories')).rows[0].n,1);
    await db.exec('RESET ROLE');
    for (const mutation of ["UPDATE posts SET visibility='private' WHERE id=101", "UPDATE posts SET author_id=3 WHERE id=101", "UPDATE user_settings SET settings='{\"privacy\":{\"privateAccount\":true}}' WHERE auth_id='fixture-author'", 'INSERT INTO blocks VALUES(2,1)', 'DELETE FROM posts WHERE id=101']) {
      await db.exec('BEGIN'); await db.exec(mutation); await db.exec('SET ROLE authenticated');
      assert.equal((await db.query('SELECT count(*)::int AS n FROM stories')).rows[0].n,0,mutation);
      await db.exec('RESET ROLE');
      assert.equal((await share(db)).code,'source_unavailable','replay cannot reinsert a hidden source into cache');
      await db.exec('ROLLBACK');
    }
  } finally { await db.close(); }
});

test('deleted/expired story retry never resurrects it or sends again', async () => {
  const db = await fixture();
  try {
    await share(db);
    await db.exec("UPDATE stories SET expires_at=now()-interval '1 second'");
    assert.equal((await share(db)).code,'story_unavailable');
    await db.exec('DELETE FROM stories');
    assert.equal((await share(db)).code,'story_unavailable');
    assert.equal((await counts(db)).messages,1);
  } finally { await db.close(); }
});
