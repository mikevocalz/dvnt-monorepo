// Run offline: NODE_PATH=<directory containing @electric-sql/pglite> node --test scripts/test-event-attendee-privacy-sql.cjs
// This executes the actual repository RPCs and migration in PostgreSQL (PGlite).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { database, installAttendanceCounters, privacyMigration, aliasLegacyHome, as, call, home10, home11, forYou } = require('./fixtures/event-attendee-privacy/database.cjs');

const hidden = [2,3,10,15,16];
const ordinary = [1,5,6,7,8,9];
const socialReaders = [null,'stranger','attendee','ticket-holder','owner','admin','editor','pending','scanner'];
async function run(action, options) {
  const db = await database(options);
  try { await action(db); } finally { await db.close(); }
}
const stripPrivacy = value => Array.isArray(value) ? value.map(stripPrivacy)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => !['show_attendees','attendee_list_visible','attendees_visible','lynk_room_id'].includes(key)).map(([key,v]) => [key,stripPrivacy(v)]))
    : value;
const rpcMetadata = `SELECT p.oid::regprocedure::text AS signature,
  to_jsonb(p)-ARRAY['prosrc','proargdefaults','prosqlbody'] AS metadata,
  pg_get_function_arguments(p.oid) AS arguments FROM pg_proc p
  WHERE p.pronamespace='public'::regnamespace AND p.proname IN
  ('get_event_attendee_avatars','get_event_attendee_page','get_event_detail','get_events_home','get_events_for_you') ORDER BY p.proname,p.pronargs`;

test('migration defaults hidden, accepts legacy NULL, is idempotent, and preserves existing RPC signatures/ACLs', async () => run(async db => {
  const before = (await db.query(rpcMetadata)).rows;
  const rowsBefore = (await db.query('SELECT id,event_type,lynk_room_id,total_attendees FROM events ORDER BY id')).rows;
  await db.exec(privacyMigration());
  assert.deepEqual((await db.query(rpcMetadata)).rows,before);
  const col = (await db.query("SELECT is_nullable,column_default FROM information_schema.columns WHERE table_name='events' AND column_name='show_attendees'")).rows[0];
  assert.equal(col.is_nullable,'YES');
  assert.equal(col.column_default,'false');
  assert.equal((await db.query('SELECT count(*)::integer AS n FROM events WHERE show_attendees=false')).rows[0].n,17);
  await db.exec(privacyMigration());
  assert.deepEqual((await db.query(rpcMetadata)).rows,before);
  assert.deepEqual((await db.query('SELECT id,event_type,lynk_room_id,total_attendees FROM events ORDER BY id')).rows,rowsBefore);
}, { migrate:false }));

test('ordinary categories, titles, NSFW flags and unlinked virtual events retain existing social behavior', async () => run(async db => {
  const before = await as(db,'authenticated','attendee',async () => ({
    home10: await call(db,home10), home11: await call(db,home11), forYou: await call(db,forYou),
    details: await Promise.all(ordinary.map(id => call(db,'get_event_detail($1,2)',[id]))),
  }));
  await db.exec(privacyMigration()); await aliasLegacyHome(db);
  await as(db,'authenticated','attendee',async () => {
    for (const [label,expression] of [['home10',home10],['home11',home11],['forYou',forYou]]) {
      const result = await call(db,expression);
      for (const id of ordinary) {
        assert.deepEqual(stripPrivacy(result.find(row=>row.id===id)),stripPrivacy(before[label].find(row=>row.id===id)),`${label}, event ${id}`);
        assert.ok(result.find(row=>row.id===id).attendee_avatars.length>0);
      }
    }
    for (let i=0;i<ordinary.length;i++) assert.deepEqual(stripPrivacy(await call(db,'get_event_detail($1,2)',[ordinary[i]])),stripPrivacy(before.details[i]));
  });
  // Ordinary discovery was already public; the protected-type change must not narrow it.
  await as(db,'anon',null,async()=>{
    for(const expression of [home10,home11]) {
      const result=await call(db,expression);
      for(const id of ordinary) assert.ok(result.find(row=>row.id===id).attendee_avatars.length>0);
    }
  });
}, { migrate:false }));

test('protected default/NULL lists are empty across avatar, page, detail and discovery RPCs for every reader', async () => run(async db => {
  for (const reader of socialReaders) await as(db,reader?'authenticated':'anon',reader,async()=>{
    for(const id of hidden) {
      assert.deepEqual(await call(db,'get_event_attendee_avatars($1)',[id]),[],`avatars ${id}, ${reader}`);
      assert.deepEqual(await call(db,'get_event_attendee_page($1,24,0)',[id]),[],`page ${id}, ${reader}`);
      const detail=await call(db,'get_event_detail($1,2)',[id]);
      assert.ok(detail,`event remains accessible: ${id}, ${reader}`);
      assert.deepEqual(detail.attendees.avatars,[],`detail ${id}, ${reader}`);
      assert.equal(detail.attendees.total,9,'aggregate attendance is not an identity');
      assert.equal(detail.ticket_tiers[0].price_cents,1000);
    }
    for(const expression of [home10,home11,forYou]) {
      const result=await call(db,expression);
      for(const id of hidden) {
        const event=result.find(row=>row.id===id);
        assert.ok(event,`discovery still lists ${id}`);
        assert.deepEqual(event.attendee_avatars,[],`${expression}: ${id}, ${reader}`);
        if('friends_going' in event) assert.equal(event.friends_going,0);
      }
    }
  });
  await as(db,'service_role',null,async()=>{
    for(const id of hidden) assert.deepEqual(await call(db,'get_event_attendee_avatars($1)',[id]),[],'service RPC still honors hidden social list');
    assert.equal((await call(db,'get_event_attendee_avatars(4)')).length,3,'service role may read opted-in attendees');
  });
}));

test('explicit opt-in still requires existing event visibility and attendance and supports pagination', async () => run(async db => {
  for(const reader of [null,'stranger','pending']) await as(db,reader?'authenticated':'anon',reader,async()=>{
    assert.deepEqual(await call(db,'get_event_attendee_avatars(4)'),[]);
    assert.deepEqual(await call(db,'get_event_attendee_page(4,24,0)'),[]);
    assert.deepEqual((await call(db,'get_event_detail(4,2)')).attendees.avatars,[],'spoofed viewer id does not grant attendance');
    for(const expression of [home10,home11,forYou]) {
      const event=(await call(db,expression)).find(row=>row.id===4);
      assert.deepEqual(event.attendee_avatars,[]);
      if('friends_going' in event) assert.equal(event.friends_going,0);
    }
    for(const id of [11,12,13]) {
      const detail=await call(db,'get_event_detail($1,2)',[id]);
      if(reader==='pending') assert.deepEqual(detail?.attendees.avatars||[],[],'pre-existing event access does not grant guest access');
      else assert.equal(detail,null);
      assert.deepEqual(await call(db,'get_event_attendee_page($1,24,0)',[id]),[]);
    }
  });
  for(const reader of ['attendee','ticket-holder','owner','admin','editor']) await as(db,'authenticated',reader,async()=>{
    assert.equal((await call(db,'get_event_attendee_avatars(4)')).length,3,reader);
    assert.equal((await call(db,'get_event_attendee_page(4,1,0)')).length,1);
    assert.notDeepEqual(await call(db,'get_event_attendee_page(4,1,0)'),await call(db,'get_event_attendee_page(4,1,1)'));
    for(const expression of [home10,home11]) assert.ok((await call(db,expression)).find(row=>row.id===4).attendee_avatars.length>0);
  });
  await as(db,'authenticated','owner',async()=>{
    for(const id of [11,12,13]) assert.ok((await call(db,'get_event_attendee_avatars($1)',[id])).length>0);
  });
  await as(db,'anon',null,async()=>{
    for(const expression of [home10,home11,forYou]) {
      const rows=await call(db,expression);
      for(const id of [11,12,13]) assert.ok(!rows.some(row=>row.id===id));
    }
  });
}));

test('direct PostgREST-equivalent RLS hides identities but preserves own RSVP/tickets and authorized management', async () => run(async db => {
  const read = id => db.query('SELECT user_id,status FROM event_rsvps WHERE event_id=$1 ORDER BY user_id',[id]).then(result=>result.rows);
  await as(db,'anon',null,async()=>{
    assert.deepEqual(await read(2),[]);
    assert.deepEqual(await read(4),[],'opt-in does not grant anonymous attendance access');
    assert.equal((await read(1)).length,2,'ordinary direct RSVP behavior unchanged');
  });
  for(const reader of ['attendee','friend']) await as(db,'authenticated',reader,async()=>{
    assert.deepEqual(await read(2),[{user_id:reader,status:'going'}]);
    const detail=await call(db,'get_event_detail(2,5)');
    assert.equal(detail.user_rsvp_status,'going','verified caller keeps personal RSVP state');
    assert.equal((await read(4)).length,2,'opted-in attendee can read list');
    await db.query("UPDATE event_rsvps SET status='interested' WHERE event_id=2 AND user_id=$1",[reader]);
    assert.equal((await read(2))[0].status,'interested','own RSVP write remains available');
  });
  for(const reader of ['owner','admin','editor']) await as(db,'authenticated',reader,async()=>assert.equal((await read(2)).length,2,reader));
  for(const reader of ['stranger','pending','scanner','co-viewer']) await as(db,'authenticated',reader,async()=>assert.deepEqual(await read(2),[],reader));
  await as(db,'authenticated','ticket-holder',async()=>{
    assert.equal((await db.query('SELECT id FROM tickets WHERE event_id=2')).rows.length,1);
    assert.deepEqual(await read(2),[],'own ticket is not permission to reveal a hidden list');
  });
  await as(db,'service_role',null,async()=>assert.equal((await read(2)).length,2));
}));

test('friends-going values and ranking cannot reveal hidden RSVP participation', async () => run(async db => {
  const get=()=>call(db,forYou).then(rows=>new Map(rows.map(row=>[row.id,row])));
  const before=await as(db,'authenticated','attendee',get);
  assert.equal(before.get(2).friends_going,0);
  assert.equal(before.get(2).score,before.get(15).score,'same protected metadata, with/without a friend RSVP');
  assert.equal(before.get(4).friends_going,1);
  assert.equal(before.get(1).friends_going,1);
  await db.exec("DELETE FROM event_rsvps WHERE user_id='friend'");
  const after=await as(db,'authenticated','attendee',get);
  for(const id of hidden) assert.equal(after.get(id).score,before.get(id).score,`hidden score ${id}`);
  assert.equal(before.get(4).score-after.get(4).score,10,'opt-in keeps authorized friend scoring');
  assert.equal(before.get(1).score-after.get(1).score,10,'ordinary score remains unchanged');
}));

async function directToggle(db, reader, id, next) {
  return as(db,'authenticated',reader,async()=>{
    try { return (await db.query('UPDATE events SET show_attendees=$2 WHERE id=$1 RETURNING id',[id,next])).rows.length===1; }
    catch(error) {
      assert.match(error.message,/permission|authorized|owner|organizer|manage|denied|policy|forbidden/i);
      return false;
    }
  });
}
test('only owner and accepted admin/editor may change the setting through direct table updates', async () => run(async db => {
  for(const reader of ['stranger','attendee','pending','scanner','co-viewer']) {
    assert.equal(await directToggle(db,reader,2,true),false,reader);
    assert.equal((await db.query('SELECT show_attendees FROM events WHERE id=2')).rows[0].show_attendees,false);
  }
  for(const reader of ['owner','admin','editor']) {
    assert.equal(await directToggle(db,reader,2,true),true,reader);
    assert.equal(await directToggle(db,reader,2,false),true,reader);
  }
}));

test('type/link transitions default hidden, clear stale opt-ins, and permit explicit opt-in on entry', async () => run(async db => {
  const row=()=>db.query('SELECT event_type,lynk_room_id,show_attendees FROM events WHERE id=17').then(result=>result.rows[0]);
  await as(db,'authenticated','owner',async()=>{
    await db.exec("UPDATE events SET event_type='sex_party' WHERE id=17");
    assert.equal((await row()).show_attendees,false);
    await db.exec('UPDATE events SET show_attendees=true WHERE id=17');
    await db.exec("UPDATE events SET event_type='party' WHERE id=17");
    assert.equal((await row()).show_attendees,false,'leaving protected scope clears opt-in');
    await db.exec("UPDATE events SET event_type='sex_party',show_attendees=true WHERE id=17");
    assert.equal((await row()).show_attendees,true,'explicit new opt-in is honored');
    await db.exec("UPDATE events SET event_type='party' WHERE id=17");
    await db.exec("UPDATE events SET lynk_room_id='00000000-0000-4000-8000-000000000017' WHERE id=17");
    assert.equal((await row()).show_attendees,false,'linking a room defaults hidden');
    await db.exec('UPDATE events SET show_attendees=true WHERE id=17');
    await db.exec('UPDATE events SET lynk_room_id=NULL WHERE id=17');
    assert.equal((await row()).show_attendees,false,'unlink clears stale opt-in');
    await db.exec("UPDATE events SET lynk_room_id='00000000-0000-4000-8000-000000000017',show_attendees=true WHERE id=17");
    assert.equal((await row()).show_attendees,true);
  });
}));

test('pending/limited co-organizers cannot remove protection or take ownership to bypass the visibility setting', async () => run(async db => {
  for(const reader of ['pending','scanner','co-viewer']) {
    for(const statement of [
      "UPDATE events SET event_type='party' WHERE id=2",
      'UPDATE events SET lynk_room_id=NULL WHERE id=3',
      "UPDATE events SET category='music' WHERE id=2",
      `UPDATE events SET host_id='${reader}' WHERE id=2`,
      `UPDATE events SET host_id='${reader}',show_attendees=true WHERE id=2`,
    ]) await as(db,'authenticated',reader,async()=>{
      await assert.rejects(db.exec(statement),/organizer|owner|visibility|permission|authorized/i,`${reader}: ${statement}`);
    });
  }
  assert.deepEqual((await db.query('SELECT event_type,show_attendees,host_id FROM events WHERE id=2')).rows,[{event_type:'sex_party',show_attendees:false,host_id:'owner'}]);
  assert.ok((await db.query('SELECT lynk_room_id FROM events WHERE id=3')).rows[0].lynk_room_id);
}));

test('new sensitive rows default hidden; only their organizer can insert an explicit opt-in', async () => run(async db => {
  await as(db,'authenticated','owner',async()=>{
    await db.exec("INSERT INTO events(id,title,event_type,host_id) VALUES(100,'New protected','sex_party','owner')");
    await db.exec("INSERT INTO events(id,title,event_type,host_id,show_attendees) VALUES(101,'New opt in','sex_party','owner',true)");
    await db.exec("INSERT INTO events(id,title,event_type,host_id,lynk_room_id) VALUES(102,'New linked','party','owner','00000000-0000-4000-8000-000000000102')");
    await db.exec("INSERT INTO events(id,title,event_type,host_id,show_attendees) VALUES(103,'Ordinary no latent opt in','party','owner',true)");
  });
  assert.deepEqual((await db.query('SELECT id,show_attendees FROM events WHERE id>=100 ORDER BY id')).rows,[
    {id:100,show_attendees:false},{id:101,show_attendees:true},{id:102,show_attendees:false},{id:103,show_attendees:false},
  ]);
  await as(db,'authenticated','stranger',async()=>{
    await assert.rejects(db.exec("INSERT INTO events(id,title,event_type,host_id,show_attendees) VALUES(104,'Not my event','sex_party','owner',true)"),/organizer|owner|permission/i);
  });
}));

test('legacy ordinary true does not become a latent opt-in when converted to protected', async () => run(async db => {
  await db.exec('ALTER TABLE events ADD COLUMN show_attendees boolean DEFAULT false');
  await db.exec('UPDATE events SET show_attendees=true WHERE id=17');
  await db.exec(privacyMigration());
  await as(db,'authenticated','owner',async()=>{
    await db.exec("UPDATE events SET event_type='sex_party' WHERE id=17");
    assert.equal((await db.query('SELECT show_attendees FROM events WHERE id=17')).rows[0].show_attendees,false);
  });
}, { migrate:false }));

test('revoked attendance immediately removes opted-in access without affecting own ticket reads', async () => run(async db => {
  await db.exec("UPDATE tickets SET status='refunded' WHERE user_id='ticket-holder' AND event_id=4");
  await as(db,'authenticated','ticket-holder',async()=>{
    assert.deepEqual(await call(db,'get_event_attendee_avatars(4)'),[]);
    assert.equal((await db.query('SELECT id,status FROM tickets WHERE event_id=4')).rows[0].status,'refunded');
  });
  await db.exec("UPDATE tickets SET status='scanned' WHERE user_id='ticket-holder' AND event_id=4");
  await as(db,'authenticated','ticket-holder',async()=>{
    for(const expression of ['get_event_attendee_avatars(4)','get_event_attendee_page(4,24,0)']) {
      const attendees=await call(db,expression);
      assert.ok(attendees.some(row=>row.username==='fixture_ticket_holder'),'scanned guest remains on opted-in list');
      assert.equal(attendees.length,3);
    }
  });
  await db.exec("UPDATE event_rsvps SET status='interested' WHERE user_id='attendee' AND event_id=4");
  await as(db,'authenticated','attendee',async()=>{
    assert.deepEqual(await call(db,'get_event_attendee_avatars(4)'),[]);
    assert.deepEqual((await db.query('SELECT user_id,status FROM event_rsvps WHERE event_id=4')).rows,[{user_id:'attendee',status:'interested'}]);
  });
}));

test('unexpected RPC drift fails and rolls back the column, helpers, policies and all RPC replacements', async () => run(async db => {
  const original=(await db.query("SELECT pg_get_functiondef('public.get_events_for_you(integer,integer,integer)'::regprocedure) AS definition")).rows[0].definition;
  await db.exec(original.replace(') friends ON true',') friends ON (true)'));
  const before=(await db.query(rpcMetadata.replace('AS arguments FROM','AS arguments, pg_get_functiondef(p.oid) AS definition FROM'))).rows;
  await assert.rejects(db.exec(privacyMigration()),/definition drift/);
  await db.exec('ROLLBACK');
  assert.deepEqual((await db.query(rpcMetadata.replace('AS arguments FROM','AS arguments, pg_get_functiondef(p.oid) AS definition FROM'))).rows,before);
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM information_schema.columns WHERE table_name='events' AND column_name='show_attendees'")).rows[0].n,0);
  assert.equal((await db.query("SELECT to_regprocedure('public.event_attendees_visible(integer)') AS helper")).rows[0].helper,null);
  assert.equal((await db.query("SELECT count(*)::integer AS n FROM pg_policy WHERE polname='event_rsvps_attendee_visibility'")).rows[0].n,0);
}, { migrate:false }));


test('two-step ownership takeover is denied for pending/scanner/admin/editor; service transfer remains possible', async () => run(async db => {
  for(const reader of ['pending','scanner','admin','editor']) {
    await as(db,'authenticated',reader,async()=>{
      await assert.rejects(db.query('UPDATE events SET host_id=$1 WHERE id=2',[reader]),/current owner|ownership|permission/i);
    });
    assert.equal((await db.query('SELECT host_id FROM events WHERE id=2')).rows[0].host_id,'owner');
    if(['pending','scanner'].includes(reader)) {
      assert.equal(await directToggle(db,reader,2,true),false,'failed takeover did not grant setting authority');
      await as(db,'authenticated',reader,async()=>assert.deepEqual((await db.query('SELECT user_id FROM event_rsvps WHERE event_id=2')).rows,[]));
    }
  }
  await as(db,'service_role',null,async()=>{
    await db.query("UPDATE events SET host_id='stranger' WHERE id=2");
  });
  assert.equal((await db.query('SELECT host_id FROM events WHERE id=2')).rows[0].host_id,'stranger');
  assert.equal(await directToggle(db,'stranger',2,true),true,'legitimate new owner controls preference');
}));


test('real RSVP counter and owner-guard triggers allow non-owner writes while preserving privacy flags', async () => run(async db => {
  await installAttendanceCounters(db);
  const ids=[1,2,3,4,10]; // ordinary, Sex Party, linked, opted in, legacy NULL
  const expectedFlags=[false,false,false,true,null];
  const counters=()=>db.query('SELECT id,total_attendees,show_attendees FROM events WHERE id=ANY($1::integer[]) ORDER BY id',[ids]).then(result=>result.rows);
  const expected=count=>ids.map((id,index)=>({id,total_attendees:count,show_attendees:expectedFlags[index]}));
  assert.deepEqual(await counters(),expected(3));
  await as(db,'authenticated','stranger',async()=>{
    for(const id of ids) await db.query("INSERT INTO event_rsvps(event_id,user_id,status,created_at) VALUES($1,'stranger','going',now())",[id]);
    assert.deepEqual(await counters(),expected(4),'SECURITY DEFINER counter sees all participants despite restrictive RSVP RLS');
    for(const id of ids) {
      const detail=await call(db,'get_event_detail($1,1)',[id]);
      assert.equal(detail.user_rsvp_status,'going');
      assert.equal(detail.attendees.total,4);
      if([2,3,10].includes(id)) assert.deepEqual(detail.attendees.avatars,[]);
    }
    await db.query("UPDATE event_rsvps SET status='interested' WHERE user_id='stranger' AND event_id=ANY($1::integer[])",[ids]);
    assert.deepEqual(await counters(),expected(3));
    await db.query("UPDATE event_rsvps SET status='going' WHERE user_id='stranger' AND event_id=ANY($1::integer[])",[ids]);
    assert.deepEqual(await counters(),expected(4));
    await db.query("DELETE FROM event_rsvps WHERE user_id='stranger' AND event_id=ANY($1::integer[])",[ids]);
    assert.deepEqual(await counters(),expected(3));
  });
}));

test('latest ticket counter keeps seats across check-in/transfer and recomputes both events after moves', async () => run(async db => {
  await installAttendanceCounters(db);
  const count=id=>db.query('SELECT total_attendees FROM events WHERE id=$1',[id]).then(result=>result.rows[0].total_attendees);
  await as(db,'service_role',null,async()=>{
    for(const [status,expected] of [['scanned',3],['transfer_pending',3],['refunded',2],['void',2],['active',3]]) {
      await db.query('UPDATE tickets SET status=$1 WHERE id=2',[status]);
      assert.equal(await count(2),expected,status);
    }
    await db.exec('UPDATE tickets SET event_id=3 WHERE id=2');
    assert.equal(await count(2),2,'old event recalculated');
    assert.equal(await count(3),4,'multiple seats held by one account still count separately');
    await db.exec("INSERT INTO tickets(id,event_id,user_id,status) VALUES(100,2,NULL,'active')");
    assert.equal(await count(2),3,'guest checkout seat counts without an account identifier');
    await db.exec('DELETE FROM tickets WHERE id=100');
    assert.equal(await count(2),2);
  });
  await as(db,'authenticated','stranger',async()=>{
    await db.exec("INSERT INTO event_rsvps(event_id,user_id,status) VALUES(2,'stranger','going')");
    assert.equal(await count(2),3);
    await db.exec("UPDATE event_rsvps SET event_id=3 WHERE event_id=2 AND user_id='stranger'");
    assert.equal(await count(2),2,'RSVP move recalculates old event');
    assert.equal(await count(3),5,'RSVP move recalculates new event');
  });
  await as(db,'authenticated','ticket-holder',async()=>{
    await db.exec("INSERT INTO event_rsvps(event_id,user_id,status) VALUES(3,'ticket-holder','going')");
    assert.equal(await count(3),5,'ticket holder RSVP is not an extra person');
    assert.deepEqual(await call(db,'get_event_attendee_avatars(3)'),[],'counter mutations never expose a hidden list');
  });
  assert.deepEqual((await db.query('SELECT show_attendees FROM events WHERE id IN (2,3) ORDER BY id')).rows,[{show_attendees:false},{show_attendees:false}]);
}));
