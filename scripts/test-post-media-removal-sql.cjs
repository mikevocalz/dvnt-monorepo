/* Synthetic PostgreSQL only. No hosted database, credentials, or storage. */
const { readFileSync } = require("node:fs");
const { PGlite } = require("@electric-sql/pglite");
const { strict: assert } = require("node:assert");
const { test, before, after } = require("node:test");
const read = (path) => readFileSync(new URL(path, require("node:url").pathToFileURL(__filename)), "utf8");
const db = new PGlite();
const rpc = async (author, expected, remove, caption, post = 1, expectedCaption = "old") =>
  (await db.query("SELECT public.remove_owned_post_media($1,$2,$3,$4,$5,$6) AS result",
    [post, author, expected, remove, { content: caption }, expectedCaption])).rows[0].result;
const ids = ["a", "b", "c", "d"];

before(async () => {
  await db.exec(read("./fixtures/live-photo-roundtrip/schema.sql"));
  await db.exec("ALTER TABLE posts_media ADD COLUMN thumbnail text");
  await db.exec("CREATE TABLE post_tags(id int PRIMARY KEY, post_id bigint, media_index int NOT NULL, tagged_user_id int, UNIQUE(post_id, tagged_user_id, media_index));");
  await db.exec("INSERT INTO users (id,username) VALUES (2,'other'); INSERT INTO posts (author_id,content,visibility,is_nsfw) VALUES (1,'old','private',true),(2,'other','public',false)");
  await db.exec("INSERT INTO posts_media (id,_parent_id,_order,type,url,live_photo_video_url) VALUES ('a',1,0,'image','same',null),('b',1,1,'livePhoto','same','motion'),('c',1,3,'image','still',null),('d',1,5,'video','video',null),('t',1,6,'thumbnail','same',null),('foreign',2,0,'image','same',null)");
  await db.exec("INSERT INTO post_tags VALUES (1,1,0,7),(2,1,1,7),(3,1,2,7),(4,1,3,7),(5,2,0,7)");
  await db.exec(read("../apps/mobile/supabase/migrations/20261124162200_owner_post_media_removal.sql"));
});
after(async () => db.close());

test("refuses cross-owner, stale and final-item removal without changing caption or media", async () => {
  assert.equal((await rpc(2, ids, ["b"], "not yours")).result, "unavailable");
  assert.equal((await rpc(1, ["c", "b", "a", "d"], ["b"], "stale")).result, "changed");
  assert.equal((await rpc(1, ids, ids, "empty")).result, "last_item");
  assert.equal((await rpc(1, ids, ["foreign"], "other")).result, "changed");
  assert.equal((await db.query("SELECT content FROM posts WHERE id=1")).rows[0].content, "old");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM posts_media WHERE _parent_id=1")).rows[0].n, 5);
});

test("stale caption cannot change attachments, or overwrite a newer caption", async () => {
  await db.exec("UPDATE posts SET content='concurrent' WHERE id=1");
  assert.equal((await rpc(1, ids, ["b"], "my edit")).result, "caption_changed");
  assert.equal((await db.query("SELECT content FROM posts WHERE id=1")).rows[0].content, "concurrent");
  assert.equal((await db.query("SELECT count(*)::int AS n FROM posts_media WHERE _parent_id=1")).rows[0].n, 5);
  await db.exec("UPDATE posts SET content='old' WHERE id=1");
});

test("rolls back tags, media and caption together on a failed write", async () => {
  await db.exec("ALTER TABLE posts ADD CONSTRAINT refuse_caption CHECK (content <> 'fail')");
  await assert.rejects(() => rpc(1, ids, ["b"], "fail"), /refuse_caption/);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM posts_media WHERE _parent_id=1 AND id='b'")).rows[0].n, 1);
  assert.deepEqual((await db.query("SELECT media_index FROM post_tags WHERE post_id=1 ORDER BY media_index")).rows.map(x => x.media_index), [0, 1, 2, 3]);
  assert.equal((await db.query("SELECT content FROM posts WHERE id=1")).rows[0].content, "old");
});

test("removes exact Live Photo even with duplicate still, retains media order/state and shifts tags", async () => {
  const result = await rpc(1, ids, ["b"], "new");
  assert.deepEqual(result.remainingIds, ["a", "c", "d"]);
  assert.equal(result.post.content, "new");
  assert.equal(result.post.visibility, "private");
  assert.equal(result.post.is_nsfw, true);
  const rows = (await db.query("SELECT id, url, live_photo_video_url FROM posts_media WHERE _parent_id=1 ORDER BY _order")).rows;
  assert.deepEqual(rows.map(x => x.id), ["a", "c", "d"]);
  assert.equal(rows[0].url, "same");
  assert.equal((await db.query("SELECT url FROM posts_media WHERE id='foreign'")).rows[0].url, "same");
  assert.deepEqual((await db.query("SELECT id,media_index FROM post_tags WHERE post_id=1 ORDER BY media_index")).rows,
    [{ id: 1, media_index: 0 }, { id: 3, media_index: 1 }, { id: 4, media_index: 2 }]);
  assert.equal((await rpc(1, ids, ["b"], "stale again", 1, "new")).result, "changed");
  assert.equal((await db.query("SELECT content FROM posts WHERE id=1")).rows[0].content, "new");
});

test("RPC grants execution only to the existing service role", async () => {
  const result = (await db.query("SELECT r, has_function_privilege(r,'public.remove_owned_post_media(bigint,integer,text[],text[],jsonb,text)','execute') AS allow FROM unnest(ARRAY['anon','authenticated','service_role']) AS r")).rows;
  assert.deepEqual(result.map(x => x.allow), [false, false, true]);
});
