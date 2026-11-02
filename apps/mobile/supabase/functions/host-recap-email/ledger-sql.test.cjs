const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {createHash}=require('node:crypto');const {PGlite}=require('@electric-sql/pglite');
const migration=()=>fs.readFileSync(path.join(__dirname,'../../migrations',fs.readdirSync(path.join(__dirname,'../../migrations')).find(n=>n.endsWith('_host_recap_scoped_delivery.sql'))),'utf8');
test('host recap ledger uses synthetic isolated PostgreSQL only',async t=>{
const db=new PGlite(),q=async(s,p=[])=>(await db.query(s,p)).rows;try{
await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
CREATE TABLE events(id int PRIMARY KEY,host_id text,start_date timestamptz,end_date timestamptz,status text,cancelled_at timestamptz);
CREATE TABLE "user"(id text PRIMARY KEY,email text,"emailVerified" boolean);
CREATE TABLE users(id int,auth_id text,email text,banned_at timestamptz);CREATE TABLE brand_message_opt_outs(recipient_id int);CREATE TABLE event_followup_email_suppressions(email text);
CREATE TABLE orders(event_id int,total_cents int,paid_at timestamptz,status text);CREATE TABLE tickets(event_id int,purchase_amount_cents int);
INSERT INTO "user" VALUES('a','Host@example.test',false),('b','verified@example.test',true),('c','other@example.test',true);
INSERT INTO users VALUES(1,'a','host@example.test',NULL),(2,'b','verified@example.test',NULL);
INSERT INTO events SELECT x,CASE WHEN x=1 THEN 'a' ELSE 'b' END,now()-interval '3 days',now()-interval '2 days','active',NULL FROM generate_series(1,6) x;`);
await db.exec(migration());
const subject='Synthetic recap',html='<p>Synthetic summary</p>',hash=createHash('sha256').update(subject+'\n'+html).digest('hex');
const enqueue=async(ids,period='2026-10',kind='financial',confirmed=null)=> (await q('select enqueue_host_recap($1,$2,$3,$4,$5,$6,$7) id',[ids,period,kind,subject,html,hash,confirmed]))[0].id;
const claim=async id=>(await q('select claim_host_recap($1,$2,$3) v',[id,hash,'DVNT <hello@example.test>']))[0].v;
let financial,generic;
await t.test('explicit confirmation binds unverified financial address; generic cannot bypass',async()=>{
await assert.rejects(enqueue([1]),/ineligible/);await assert.rejects(enqueue([1],'2026-10','financial','wrong@example.test'),/ineligible/);
await assert.rejects(enqueue([1],'2026-10','generic','host@example.test'),/Invalid/);
financial=await enqueue([1],'2026-10','financial','HOST@example.test');assert.equal(await enqueue([1],'2026-10','financial','host@example.test'),financial);
generic=await enqueue([2],'2026-10','generic');
await assert.rejects(enqueue([2],'2026-10','financial'),/conflict/);
});
await t.test('scope/hash/period validation and host isolation',async()=>{
for(const ids of [[],[1,1],[1,2],[999],[null],null])await assert.rejects(enqueue(ids),/scope|ineligible/);
await assert.rejects(enqueue([2],'2026-13'),/Invalid/);
await assert.rejects(q('select enqueue_host_recap(ARRAY[2],$1,$2,$3,$4,$5,NULL)',['2026-11','generic',subject,html,'0'.repeat(64)]),/Invalid/);
});
await t.test('at most one claim and no retry of accepted or ambiguous provider result',async()=>{
assert.equal((await claim(financial)).status,'claimed');assert.equal((await claim(financial)).status,'sending');
assert.equal((await q('select complete_host_recap($1,NULL,$2) v',[financial,'ambiguous']))[0].v,true);assert.equal((await claim(financial)).status,'unknown');
assert.equal((await q('select complete_host_recap($1,$2,NULL) v',[financial,'later']))[0].v,false);
assert.equal((await claim(generic)).status,'claimed');assert.equal((await q('select complete_host_recap($1,$2,NULL) v',[generic,'synthetic-provider-id']))[0].v,true);
assert.equal((await claim(generic)).status,'accepted');assert.equal((await claim(generic)).provider_message_id,'synthetic-provider-id');
await assert.rejects(q('select claim_host_recap($1,$2,$3)',[generic,'0'.repeat(64),'sender']),/mismatch/);
});
await t.test('claim holds changed host, email, suppression, verification and approval',async()=>{
for(const [period,change,restore] of [
['2026-01',"update events set host_id='c' where id=2","update events set host_id='b' where id=2"],
['2026-02',`update "user" set email='changed@example.test' where id='b'`,`update "user" set email='verified@example.test' where id='b'`],
['2026-03',"insert into event_followup_email_suppressions values(' VERIFIED@example.test ')",'delete from event_followup_email_suppressions'],
['2026-04','insert into brand_message_opt_outs values(2)','delete from brand_message_opt_outs'],
['2026-05',`update "user" set "emailVerified"=false where id='b'`,`update "user" set "emailVerified"=true where id='b'`],
['2026-06',"update events set status='cancelled' where id=2","update events set status='active' where id=2"],
['2025-01',"update users set email='mismatch@example.test' where id=2","update users set email='verified@example.test' where id=2"],
['2025-02',"update users set banned_at=now() where id=2","update users set banned_at=NULL where id=2"],
['2025-03',"update events set status='draft' where id=2","update events set status='active' where id=2"],
['2025-04',"update events set cancelled_at=now() where id=2","update events set cancelled_at=NULL where id=2"],
['2025-05',"update users set auth_id='different' where id=2","update users set auth_id='b' where id=2"]]){
const id=await enqueue([2],period,'generic');await q(change);assert.equal((await claim(id)).status,'held');await q(restore);assert.equal((await claim(id)).status,'held');}
const id=await enqueue([2],'2026-07','generic');await q("update host_recap_deliveries set html='changed' where id=$1",[id]);assert.equal((await claim(id)).status,'held');
});
await t.test('generic rejects ever-charged fully or partly refunded and late new charges',async()=>{
for(const status of ['paid','partially_refunded','refunded']){await q('insert into orders values(3,100,NULL,$1)',[status]);await assert.rejects(enqueue([3],'2027-01','generic'),/ineligible/);await q('delete from orders');}
await q("insert into orders values(3,100,now(),'payment_failed')");await assert.rejects(enqueue([3],'2027-01','generic'),/ineligible/);await q('delete from orders');
await q('insert into tickets values(3,100)');await assert.rejects(enqueue([3],'2027-01','generic'),/ineligible/);await q('delete from tickets');
await q("insert into orders values(3,0,now(),'paid')");const id=await enqueue([3],'2027-01','generic');await q("insert into orders values(3,100,now(),'paid')");assert.equal((await claim(id)).status,'held');await q('delete from orders');
});
await t.test('unfinished invalid or missing event end rejected',async()=>{
for(const change of ["end_date=NULL","end_date=now()+interval '1 day'","start_date=end_date","status='postponed'"]){await q('update events set '+change+' where id=4');await assert.rejects(enqueue([4],'2027-02','generic'),/ineligible/);await q("update events set start_date=now()-interval '3 days',end_date=now()-interval '2 days',status='active' where id=4");}
});
await t.test('dispatch is explicit one-row authenticated request, never a global drain',async()=>{
await db.exec(`CREATE SCHEMA vault; CREATE TABLE vault.decrypted_secrets(name text,decrypted_secret text);
INSERT INTO vault.decrypted_secrets VALUES('CRON_SECRET','synthetic-fixture-only');
CREATE SCHEMA net; CREATE TABLE net.requests(url text,headers jsonb,body jsonb);
CREATE FUNCTION net.http_post(url text,headers jsonb,body jsonb,timeout_milliseconds integer) RETURNS bigint LANGUAGE plpgsql AS $$ BEGIN INSERT INTO net.requests VALUES(url,headers,body); RETURN 17; END $$;`);
const id=await enqueue([5],'2027-03','generic');assert.equal((await q('select dispatch_host_recap($1,$2) v',[id,hash]))[0].v,17);
const req=(await q('select * from net.requests'))[0];assert.match(req.url,/\/host-recap-email$/);assert.deepEqual(req.body,{delivery_id:id,approved_hash:hash});assert.equal(req.headers['x-cron-secret'],'synthetic-fixture-only');
await assert.rejects(q('select dispatch_host_recap($1,$2)',[id,'0'.repeat(64)]),/approved/);await claim(id);await assert.rejects(q('select dispatch_host_recap($1,$2)',[id,hash]),/approved/);
assert.equal((await q('select count(*)::int n from net.requests'))[0].n,1);
});
await t.test('ledger RLS, service-only functions, no source writes or automatic scheduler',async()=>{
assert.equal((await q("select relrowsecurity v from pg_class where oid='host_recap_deliveries'::regclass"))[0].v,true);
for(const role of ['anon','authenticated'])assert.equal((await q("select has_table_privilege($1,'host_recap_deliveries','SELECT') v",[role]))[0].v,false);
const funcs=await q("select oid::regprocedure::text sig from pg_proc where pronamespace='public'::regnamespace and proname like '%host_recap%'");for(const f of funcs){for(const role of ['anon','authenticated'])assert.equal((await q("select has_function_privilege($1,$2,'EXECUTE') v",[role,f.sig]))[0].v,false);assert.equal((await q("select has_function_privilege('service_role',$1,'EXECUTE') v",[f.sig]))[0].v,true);}
assert.equal((await q('select count(*)::int n from events'))[0].n,6);assert.doesNotMatch(migration(),/cron\.schedule|ALTER TABLE public\.(events|orders|tickets|users)\b/i);
});
}finally{await db.close()}});
