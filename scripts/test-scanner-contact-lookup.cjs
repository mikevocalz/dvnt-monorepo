const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
const sql=File=>fs.readFileSync(path.join(root,'apps/mobile/supabase/migrations',File),'utf8');
async function fixture(){const db=new PGlite();await db.exec(`
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE events(id integer primary key,host_id text);
 CREATE TABLE event_co_organizers(event_id integer,user_id text,role text,accepted boolean);
 CREATE TABLE users(auth_id text,username text,email text);
 CREATE TABLE "user"(id text PRIMARY KEY,email text);
 CREATE TABLE user_private_profile(auth_id text,phone_e164 text);
 CREATE TABLE tickets(id text PRIMARY KEY,event_id integer,user_id text,guest_email text,guest_phone text,guest_phone_e164 text,order_id text);

 INSERT INTO events VALUES(1,'owner'),(2,'other');
 INSERT INTO event_co_organizers VALUES(1,'scanner','scanner',true),(1,'pending','scanner',false),(1,'wrong','viewer',true);
 INSERT INTO users VALUES('member','known','stale-mirror@example.com');
 INSERT INTO "user" VALUES('member','member@example.com');
 INSERT INTO user_private_profile VALUES('member','+12125550123');
 INSERT INTO tickets VALUES('one',1,'member',NULL,NULL,NULL,'o1'),('two',2,'member',NULL,NULL,NULL,'o2'),
 ('guest',1,NULL,'guest@example.com','+12125550999',NULL,'o3'),('transferred',1,'member','old@example.com','+12125550000',NULL,'o4'),
 ('comp',1,NULL,NULL,NULL,'+12125550888','o5'),('legacy',1,NULL,NULL,'(212) 555-0111',NULL,'o6'),
 ('fallback',1,NULL,NULL,'+12125550119','unknown','o7'),('canonical-wins',1,NULL,NULL,'+12125550133','+12125550134','o8'),
 ('collision',1,NULL,'separate@example.com',NULL,NULL,'o9'),('out-of-event',2,NULL,'elsewhere@example.com',NULL,NULL,'o10'),
 ('email-rebound',1,NULL,'other@example.com',NULL,NULL,'o11'),('order-rebound',1,NULL,'same@example.com',NULL,NULL,'o12');
 `);
 const actualRates=sql('20260213100001_video_rooms_schema.sql');
 await db.exec(actualRates.slice(actualRates.indexOf('CREATE TABLE IF NOT EXISTS public.video_rate_limits'),actualRates.indexOf('-- is_user_banned_from_room')));
 await db.exec(sql('20261110030000_event_ticket_contact_lookup.sql'));
 // Synthetic rows with the dependent checkout migration's private contract,
 // including deliberately stale bindings that exact search must reject.
 await db.exec(`
 CREATE TABLE web_ticket_guest_contacts(ticket_id text PRIMARY KEY,order_id text,guest_email text,guest_phone text,guest_username text);
 REVOKE ALL ON web_ticket_guest_contacts FROM PUBLIC,anon,authenticated;
 INSERT INTO web_ticket_guest_contacts VALUES('guest','o3','guest@example.com','+12125550999','door_guest'),
 ('transferred','o4','old@example.com','+12125550000','former_guest'),('collision','o9','separate@example.com','+12125550005','known'),
 ('out-of-event','o10','elsewhere@example.com','+12125550006','door_guest'),('email-rebound','o11','old@example.com','+12125550007','stale_email'),
 ('order-rebound','wrong_order','same@example.com','+12125550008','stale_order');
 `);
 await db.exec(sql('20261124213000_event_ticket_identity_lookup.sql'));return db;}

async function lookup(db,actor,kind,value,event=1){return (await db.query('SELECT id FROM lookup_event_tickets_contact($1,$2,$3,$4) ORDER BY id',[event,actor,kind,value])).rows.map(x=>x.id);}
test('exact staff contact lookup is event scoped and uses current holder contact, not transferred purchaser',async()=>{const db=await fixture();try{
 assert.deepEqual(await lookup(db,'scanner','email',' MEMBER@example.com '),['one','transferred']);
 assert.deepEqual(await lookup(db,'scanner','phone','+12125550123'),['one','transferred']);
 assert.deepEqual(await lookup(db,'owner','email','guest@example.com'),['guest']);
 assert.deepEqual(await lookup(db,'scanner','phone','+12125550999'),['guest']);
 assert.deepEqual(await lookup(db,'scanner','phone','+12125550888'),['comp']);
 assert.deepEqual(await lookup(db,'scanner','email','old@example.com'),[]);
 assert.deepEqual(await lookup(db,'scanner','email','stale-mirror@example.com'),[]);
 assert.deepEqual(await lookup(db,'scanner','phone','+12125550000'),[]);
 assert.deepEqual(await lookup(db,'scanner','email','%@example.com'),[]);
 assert.deepEqual(await lookup(db,'scanner','email','member_@example.com'),[]);
 for(const actor of ['stranger','pending','wrong',''])await assert.rejects(lookup(db,actor,'email','member@example.com'),/Not authorized/);
 await assert.rejects(lookup(db,'scanner','email','member@example.com',2),/Not authorized/);
 await assert.rejects(lookup(db,'scanner','email','member'),/complete email/);
 await assert.rejects(lookup(db,'scanner','phone','5550123'),/complete phone/);
 await assert.rejects(lookup(db,'scanner','bogus','member@example.com'),/Unknown contact/);
 }finally{await db.close();}});
test('exact guest label and member username use separate ownership rails and preserve phone history',async()=>{const db=await fixture();try{
 assert.deepEqual(await lookup(db,'scanner','username',' @DOOR_GUEST '),['guest']);
 assert.deepEqual(await lookup(db,'owner','username','@KNOWN'),['collision','one','transferred']);
 assert.deepEqual(await lookup(db,'scanner','username','door'),[]);
 assert.deepEqual(await lookup(db,'scanner','username','former_guest'),[]);
 assert.deepEqual(await lookup(db,'scanner','username','stale_email'),[]);
 assert.deepEqual(await lookup(db,'scanner','username','stale_order'),[]);
 assert.deepEqual(await lookup(db,'scanner','phone','+12125550005'),['collision']);
 assert.deepEqual(await lookup(db,'scanner','phone','+12125550007'),[]);
 assert.deepEqual(await lookup(db,'owner','phone','(212) 555-0111'),['legacy']);
 assert.deepEqual(await lookup(db,'owner','phone','001 212 555 0119'),['fallback']);
 assert.deepEqual(await lookup(db,'scanner','phone','+12125550134'),['canonical-wins']);
 assert.deepEqual(await lookup(db,'scanner','phone','+12125550133'),[]);
 await assert.rejects(lookup(db,'scanner','username','@@door_guest'),/complete username/);
 await assert.rejects(lookup(db,'scanner','username','door..guest'),/complete username/);
 for(const actor of ['stranger','pending','wrong',''])await assert.rejects(lookup(db,actor,'username','door_guest'),/Not authorized/);
 }finally{await db.close();}});
test('RPC is service-only and shared rate budget excludes raw contact values',async()=>{const db=await fixture();try{
 const acl=(await db.query(`SELECT has_function_privilege('anon','lookup_event_tickets_contact(integer,text,text,text)','EXECUTE') anon,has_function_privilege('authenticated','lookup_event_tickets_contact(integer,text,text,text)','EXECUTE') auth,has_function_privilege('service_role','lookup_event_tickets_contact(integer,text,text,text)','EXECUTE') service`)).rows[0];
 assert.deepEqual(acl,{anon:false,auth:false,service:true});
 for(let i=0;i<10;i++){await lookup(db,'scanner','email','guest@example.com');await lookup(db,'scanner','phone','+12125550999');await lookup(db,'scanner','username','door_guest');}
 await assert.rejects(lookup(db,'scanner','username','other'),/limit reached/);
 assert.deepEqual((await db.query('SELECT DISTINCT user_id,action FROM video_rate_limits')).rows,[{user_id:'scanner',action:'ticket_contact:1'}]);
 }finally{await db.close();}});
test('endpoint keeps every contact response PII-minimized and does not log contact failures',()=>{const src=fs.readFileSync(path.join(root,'apps/mobile/supabase/functions/get-event-tickets/index.ts'),'utf8');assert.match(src,/if \(isScanner \|\| contact\)/);assert.match(src,/if \(contact\) \{[\s\S]*?return errorResponse[\s\S]*?console.error/);assert.match(src,/verifySession/);});

const checkoutSource=process.env.DVNT_CHECKOUT_MIGRATION || path.join(root,'apps/mobile/supabase/migrations/20261124212500_web_ticket_guest_username.sql');
test('real checkout migration, scanner lookup and browser export compose through issue, rebinding and claim', {skip:!fs.existsSync(checkoutSource)}, async()=>{
 const db=new PGlite();
 try{
  await db.exec(`
   CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
   CREATE TABLE events(id integer PRIMARY KEY,host_id text);
   CREATE TABLE event_co_organizers(event_id integer,user_id text,role text,accepted boolean);
   CREATE TABLE orders(id uuid PRIMARY KEY,user_id text,type text,status text,event_id integer,guest_email text,stripe_checkout_session_id text);
   CREATE TABLE tickets(id uuid PRIMARY KEY,order_id uuid REFERENCES orders,event_id integer,user_id text,guest_email text,guest_phone text,guest_phone_e164 text,stripe_checkout_session_id text);
   CREATE TABLE users(auth_id text,username text);
   CREATE TABLE "user"(id text PRIMARY KEY,email text);
   CREATE TABLE user_private_profile(auth_id text,phone_e164 text);
   -- Existing allocator signatures are required by SQL wrapper creation.
   -- This case exercises exact contact capture+lookup, never the stubs.
   CREATE FUNCTION guest_free_checkout_atomic(uuid,jsonb,jsonb) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"ok":false}'::jsonb$$;
   CREATE FUNCTION issue_guest_rsvp_tickets(integer,text,text,text[],integer,text) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"ok":false}'::jsonb$$;
   INSERT INTO events VALUES(1,'staff'),(2,'other');
   INSERT INTO event_co_organizers VALUES(1,'scanner','scanner',true);
   INSERT INTO "user" VALUES('verified-holder','canonical@example.invalid');
   INSERT INTO users VALUES('verified-holder','actual_holder');
   INSERT INTO user_private_profile VALUES('verified-holder','+12125550111');
  `);
  const actualRates=sql('20260213100001_video_rooms_schema.sql');
  await db.exec(actualRates.slice(actualRates.indexOf('CREATE TABLE IF NOT EXISTS public.video_rate_limits'),actualRates.indexOf('-- is_user_banned_from_room')));
  await db.exec(fs.readFileSync(checkoutSource,'utf8'));
  await db.exec(sql('20261124213000_event_ticket_identity_lookup.sql'));
  const {harness}=require('../apps/mobile/supabase/functions/_shared/payment-safety.test.cjs');
  // Adapt only the database interface to the same synthetic PostgreSQL data;
  // the actual export Edge decides identity, scope and output fields.
  const relations={events:'events',event_co_organizers:'event_co_organizers',tickets:'tickets',users:'users',user:'"user"',
   user_private_profile:'user_private_profile',web_ticket_guest_contacts:'web_ticket_guest_contacts'};
  const getExport=harness({database:{from(table){
   assert.ok(Object.hasOwn(relations,table),'only approved relation expected by browser export fixture');
   const filters=[];let limit=Infinity;
   const run=async()=>({data:(await db.query('SELECT * FROM '+relations[table]+' ORDER BY '+(table==='web_ticket_guest_contacts'?'ticket_id':table==='user_private_profile'||table==='users'?'auth_id':table==='event_co_organizers'?'event_id':'id'))).rows
    .filter(row=>filters.every(filter=>filter(row))).slice(0,limit),error:null});
   const q={ select:()=>q, eq:(k,v)=>{filters.push(r=>r[k]===v);return q;},
    in:(k,v)=>{filters.push(r=>v.includes(r[k]));return q;},
    gt:(k,v)=>{filters.push(r=>r[k]>v);return q;},order:()=>q,limit:v=>{limit=v;return q;},
    maybeSingle:async()=>({data:(await run()).data[0]??null,error:null}),
    then:(yes,no)=>run().then(yes,no)};
   return q;
  }}});
  const ts=require('typescript');
  const csvModule={exports:{}};
  const csvTs=fs.readFileSync(path.join(root,'packages/app/lib/api/event-analytics.ts'),'utf8');
  const csvCode=ts.transpileModule(csvTs,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  new Function('require','module','exports',csvCode)(()=>({}),csvModule,csvModule.exports);
  const exportAttendee=async()=>{
   const r=await getExport.invoke('event-analytics',{event_id:1,action:'attendees',include_phone:true});
   assert.equal(r.status,200);
   const data=await r.json();
   assert.equal(data.attendees.length,1);
   const {ticketId,buyerUsername,buyerPhone,buyerEmail}=data.attendees[0];
   const csv=csvModule.exports.attendeesToCsv(data.attendees,{includePhone:true});
   assert.match(csv,/^Ticket ID,Username,Email,Phone Number,Name/);
   assert.ok(csv.includes([ticketId,buyerUsername??'',buyerEmail??'',buyerPhone?"'"+buyerPhone:''].join(',')+','));
   return [buyerUsername,buyerPhone,buyerEmail];
  };
  const order='00000000-0000-0000-0000-000000000111', ticket='00000000-0000-0000-0000-000000000222';
  await db.query("INSERT INTO orders VALUES($1,NULL,'event_ticket','payment_pending',1,'guest@example.invalid','fixture-bound-session')",[order]);
  await db.query("SELECT set_web_ticket_order_contact($1,'guest@example.invalid','entry_guest','+12125550199')",[order]);
  await db.query("INSERT INTO tickets VALUES($1,$2,1,NULL,'guest@example.invalid',NULL,NULL,'fixture-bound-session')",[ticket,order]);
  assert.deepEqual(await lookup(db,'scanner','username','@ENTRY_GUEST'),[ticket]);
  assert.deepEqual(await lookup(db,'scanner','phone','(212) 555-0199'),[ticket]);
  assert.deepEqual(await lookup(db,'scanner','email','guest@example.invalid'),[ticket]);
  assert.deepEqual(await exportAttendee(),['entry_guest','+12125550199','guest@example.invalid']);
  const wrongSessionTicket='00000000-0000-0000-0000-000000000223';
  await db.query("INSERT INTO tickets VALUES($1,$2,1,NULL,'guest@example.invalid',NULL,NULL,'fixture-unbound-session')",[wrongSessionTicket,order]);
  assert.deepEqual((await db.query("SELECT ticket_id FROM web_ticket_guest_contacts WHERE ticket_id=$1",[wrongSessionTicket])).rows,[],
   'same order and email cannot borrow another payment session’s captured contact');
  assert.deepEqual(await lookup(db,'scanner','username','entry_guest'),[ticket]);
  await db.query("DELETE FROM tickets WHERE id=$1",[wrongSessionTicket]);
  const access=(await db.query(`SELECT has_table_privilege('anon','web_ticket_guest_contacts','SELECT') anon,
   has_table_privilege('authenticated','web_ticket_guest_contacts','SELECT') auth`)).rows[0];
  assert.deepEqual(access,{anon:false,auth:false});
  await db.query("UPDATE tickets SET guest_email='different@example.invalid' WHERE id=$1",[ticket]);
  assert.deepEqual(await lookup(db,'scanner','username','entry_guest'),[]);
  assert.deepEqual(await lookup(db,'scanner','phone','+12125550199'),[]);
  assert.deepEqual(await lookup(db,'scanner','email','guest@example.invalid'),[]);
  assert.deepEqual(await exportAttendee(),[null,null,'different@example.invalid']);
  await db.query("UPDATE tickets SET guest_email='guest@example.invalid' WHERE id=$1",[ticket]);
  assert.deepEqual(await lookup(db,'scanner','username','entry_guest'),[],'restoring guest address does not revive a removed snapshot');
  await db.query("UPDATE tickets SET user_id='verified-holder' WHERE id=$1",[ticket]);
  assert.deepEqual(await lookup(db,'scanner','username','@actual_holder'),[ticket]);
  assert.deepEqual(await lookup(db,'scanner','email','canonical@example.invalid'),[ticket]);
  assert.deepEqual(await lookup(db,'scanner','email','guest@example.invalid'),[]);
  assert.deepEqual(await lookup(db,'scanner','phone','+12125550111'),[ticket]);
  assert.deepEqual(await exportAttendee(),['actual_holder','+12125550111','canonical@example.invalid']);
 } finally {await db.close();}
});
