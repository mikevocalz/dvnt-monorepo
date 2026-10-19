const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
const { PGlite } = require('@electric-sql/pglite');
const mod = { exports: {} };
new Function('exports', 'module', ts.transpileModule(fs.readFileSync(`${__dirname}/live-photo-handoff.ts`, 'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText)(mod.exports, mod);
const { parseLivePhotoHandoff: parse } = mod.exports;
const draft = '11111111-1111-4111-8111-111111111111';
const request = '22222222-2222-4222-8222-222222222222';
test('strict transport rejects injected owner, redirect, malformed/duplicate pairs', () => {
  assert.equal(parse({action:'create',draftId:draft,maxCount:10}).maxCount,10);
  for (const extra of [{owner:'other'}, {returnUrl:'https://evil.example'}, {maxCount:11}]) assert.throws(()=>parse({action:'create',draftId:draft,maxCount:2,...extra}));
  for (const pairs of [[], [{photoId:1,motionId:1}], [{photoId:1,motionId:2},{photoId:3,motionId:2}], [{photoId:'1',motionId:2}]]) assert.throws(()=>parse({action:'complete',draftId:draft,id:request,pairs}));
});
test('database enforces ownership, expiry, atomic batches, cancellation and replay', async () => {
  const db = new PGlite({ initialMemory: 64 * 1024 * 1024 });
  try {
    await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
      CREATE TABLE public.media(id bigint PRIMARY KEY, filename text, url text, type text, mime_type text, filesize bigint, width integer, height integer);`);
    await db.exec(fs.readFileSync(`${__dirname}/../../migrations/20261019213000_live_photo_handoff.sql`,'utf8'));
    await db.exec(`INSERT INTO media VALUES
      (1,'post-image/alice/2026/10/a.jpg','https://cdn.example/a.jpg','image','image/jpeg',100,100,100),
      (2,'post-video/alice/2026/10/a.mov','https://cdn.example/a.mov','video','video/quicktime',100,100,100),
      (3,'post-image/bob/2026/10/b.jpg','https://cdn.example/b.jpg','image','image/jpeg',100,100,100),
      (4,'post-video/alice-evil/2026/10/b.mov','https://cdn.example/b.mov','video','video/quicktime',100,100,100),
      (5,'post-image/alice/2026/10/c.jpg','https://cdn.example/c.jpg','image','image/jpeg',100,100,100),
      (6,'post-video/alice/2026/10/c.mov','https://cdn.example/c.mov','video','video/quicktime',100,100,100);`);
    await db.exec(`INSERT INTO live_photo_upload_receipts(media_id,owner_auth_id,object_key,url,mime_type,media_type)
      SELECT id,split_part(filename,'/',2),filename,url,mime_type,type FROM media;
      INSERT INTO media VALUES (7,'post-image/alice/2026/10/forged.jpg','https://cdn.example/forged.jpg','image','image/jpeg',100,100,100);`);
    const call = async (action, {owner='alice',d=draft,id=null,count=null,pairs=null,r=null}={}) => (await db.query('SELECT public.live_photo_handoff_action($1,$2,$3,$4,$5,$6,$7) AS result',[owner,action,d,id,count,pairs===null?null:JSON.stringify(pairs),r])).rows[0].result;
    const created = await call('create',{count:2}); const id=created.data.id;
    assert.equal(created.ok,true);
    assert.deepEqual(await call('create',{count:2}),created);
    assert.equal((await call('status',{id,owner:'bob'})).error.code,'NOT_FOUND');
    assert.equal((await call('status',{id,d:request})).error.code,'NOT_FOUND');
    assert.equal((await call('consume',{id,r:request})).error.code,'CONFLICT');
    for(const pairs of [[{photoId:7,motionId:2}],[{photoId:3,motionId:2}],[{photoId:1,motionId:4}],[{photoId:1,motionId:2},{photoId:5,motionId:999}],[{photoId:1,motionId:2},{photoId:1,motionId:6}]]) {
      assert.equal((await call('complete',{id,pairs})).error.code,'INVALID_MEDIA');
      assert.equal((await call('status',{id})).data.state,'pending');
    }
    // Mutating an otherwise valid public media row cannot repoint a receipt.
    await db.exec("UPDATE media SET url='https://evil.example/replaced.jpg' WHERE id=1");
    assert.equal((await call('complete',{id,pairs:[{photoId:1,motionId:2}]})).error.code,'INVALID_MEDIA');
    await db.exec("UPDATE media SET url='https://cdn.example/a.jpg' WHERE id=1");
    const pairs=[{photoId:1,motionId:2},{photoId:5,motionId:6}];
    assert.equal((await call('complete',{id,pairs})).data.state,'ready');
    assert.equal((await call('complete',{id,pairs})).ok,true);
    assert.equal((await call('complete',{id,pairs:pairs.slice(0,1)})).error.code,'CONFLICT');
    assert.equal((await call('status',{id})).data.assets,undefined);
    const consumed=await call('consume',{id,r:request});
    assert.equal(consumed.data.assets.length,2);
    assert.equal(consumed.data.assets[0].photoId,1);
    assert.deepEqual(await call('consume',{id,r:request}),consumed);
    assert.equal((await call('consume',{id,r:draft})).error.code,'CONFLICT');
    assert.equal((await call('cancel',{id})).error.code,'CONFLICT');
    const other=(await call('create',{d:request,count:1})).data.id;
    assert.equal((await call('complete',{id:other,d:request,pairs})).error.code,'INVALID_MEDIA');
    assert.equal((await call('cancel',{id:other,d:request})).data.state,'cancelled');
    assert.equal((await call('complete',{id:other,d:request,pairs:pairs.slice(0,1)})).error.code,'CONFLICT');
    assert.equal((await call('consume',{id:other,d:request,r:request})).error.code,'CONFLICT');
    await db.exec(`UPDATE live_photo_handoffs SET expires_at=now()-interval '1 second'`);
    assert.equal((await call('consume',{id,r:request})).error.code,'EXPIRED');
    for (const role of ['anon','authenticated']) {
      const rights=await db.query("SELECT has_table_privilege($1,'public.live_photo_handoffs','SELECT') AS t, has_function_privilege($1,'public.live_photo_handoff_action(text,text,uuid,uuid,integer,jsonb,uuid)','EXECUTE') AS f",[role]);
      assert.deepEqual(rights.rows[0],{t:false,f:false});
      const receiptRights=await db.query("SELECT has_table_privilege($1,'public.live_photo_upload_receipts','INSERT') AS i, has_table_privilege($1,'public.live_photo_upload_receipts','UPDATE') AS u",[role]);
      assert.deepEqual(receiptRights.rows[0],{i:false,u:false});
    }
  } finally { await db.close(); }
});
test('actual media-upload receipt block pins server fields and fails closed', async () => {
  const source=fs.readFileSync(`${__dirname}/../media-upload/index.ts`,'utf8');
  const start=source.indexOf('  const { error: receiptError }');
  const end=source.indexOf('  // Return success using existing schema column names',start);
  assert.ok(start>0 && end>start);
  const run=new (Object.getPrototypeOf(async function(){}).constructor)('supabase','insertedMedia','userId','key','publicUrl','mime','kind','isVideoKind','errorResponse',source.slice(start,end)+'\nreturn {ok:true};');
  for(const fails of [false,true]) {
    let captured;
    const db={from(table){assert.equal(table,'live_photo_upload_receipts');return {async insert(row){captured=row;return {error:fails?{code:'42P01'}:null}}}}};
    const result=await run(db,{id:25,url:'https://tampered.example'},'alice','post-image/alice/2026/10/original.jpg','https://cdn.example/original.jpg','image/jpeg','post-image',()=>false,message=>({ok:false,message}));
    assert.deepEqual(captured,{media_id:25,owner_auth_id:'alice',object_key:'post-image/alice/2026/10/original.jpg',url:'https://cdn.example/original.jpg',mime_type:'image/jpeg',media_type:'image'});
    assert.equal(result.ok,!fails);
  }
});
