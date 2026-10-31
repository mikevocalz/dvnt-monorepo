const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const {PGlite}=require('@electric-sql/pglite');
test('isolated embedded PostgreSQL follow-up lifecycle (never production)',async t=>{
 const db=new PGlite(),q=async(s,p=[])=>(await db.query(s,p)).rows;
 try {
 await db.exec(`CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE events(id integer PRIMARY KEY,title text,status text,start_date timestamptz,end_date timestamptz);
 CREATE TABLE "user"(id text PRIMARY KEY,email text,"emailVerified" boolean DEFAULT false);
 CREATE TABLE users(id integer PRIMARY KEY,auth_id text);
 CREATE TABLE ticket_types(id uuid PRIMARY KEY,event_id integer,category text);
 CREATE TABLE tickets(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),event_id integer,ticket_type_id uuid,user_id text,claimed_by text,guest_email text,status text);
 CREATE TABLE event_followup_email_suppressions(email text PRIMARY KEY);CREATE TABLE brand_message_opt_outs(recipient_id integer);
 INSERT INTO events VALUES(1,'Test','published',now()-interval '16 hours',now()-interval '10 hours'),(2,'Other','published',now()-interval '16 hours',now()-interval '10 hours'),(3,'Future','published',now()+interval '1 day',now()+interval '2 days');
 INSERT INTO "user" VALUES('owner','Owner@Example.test',false),('new','new@example.test',true);INSERT INTO users VALUES(1,'owner');
 INSERT INTO ticket_types VALUES('00000000-0000-0000-0000-000000000001',1,'admission'),('00000000-0000-0000-0000-000000000002',1,'service');
 INSERT INTO tickets(event_id,ticket_type_id,user_id,guest_email,status) VALUES
 (1,'00000000-0000-0000-0000-000000000001','owner','stale@example.test','active'),(1,'00000000-0000-0000-0000-000000000001','owner',NULL,'scanned'),
 (1,'00000000-0000-0000-0000-000000000001',NULL,'guest@example.test','active'),(1,'00000000-0000-0000-0000-000000000001',NULL,'refund@example.test','refunded'),(1,'00000000-0000-0000-0000-000000000002',NULL,'service@example.test','active');`);
 for(const file of ['20261002203000_event_followup_campaigns.sql','20261031180000_event_followup_delivery_safety.sql'])await db.exec(fs.readFileSync(path.join(__dirname,'../../migrations',file),'utf8'));
 await t.test('no enrollment on migration, bounded catchup, disabled and future protected',async()=>{
 assert.equal((await q('select count(*)::int n from event_followup_campaigns'))[0].n,0);await assert.rejects(q('select enable_event_followup_catchup(ARRAY[3])'),/completed/);await assert.rejects(q('select enable_event_followup_catchup(NULL)'),/completed/);
 await q('insert into event_followup_campaigns(event_id,enabled) values(2,false)');await assert.rejects(q('select enable_event_followup_catchup(ARRAY[2])'),/disabled/);await q('select enable_event_followup_catchup(ARRAY[1])');});
 await t.test('set-based admission audience dedupes across versions and uses owner not stale guest',async()=>{
 assert.equal((await q('select enqueue_event_followup(1) n'))[0].n,2);assert.equal((await q('select enqueue_event_followup(1) n'))[0].n,0);assert.deepEqual((await q('select recipient_email from event_followup_outbox order by recipient_email')).map(x=>x.recipient_email),['guest@example.test','owner@example.test']);await q('update event_followup_campaigns set campaign_version=2 where event_id=1');assert.equal((await q('select enqueue_event_followup(1) n'))[0].n,0);});
 await t.test('mixed-case account optout and alternate remaining admission',async()=>{
 await q('insert into brand_message_opt_outs values(1)');assert.equal((await q("select event_followup_recipient_suppressed('owner@example.test') v"))[0].v,true);await q('delete from brand_message_opt_outs');await q("update tickets set status='refunded' where id=(select id from tickets where user_id='owner' limit 1)");assert.equal((await q("select event_followup_recipient_eligible(1,'owner@example.test') v"))[0].v,true);});
 let rows=await q('select * from claim_event_followups(ARRAY[1],NULL,8)'),row=rows.find(x=>x.recipient_email==='owner@example.test');const payload={to:'owner@example.test',from:'DVNT <hello@example.test>',subject:'Review',html:'original'};
 await t.test('active claims exclusive and frozen payload stable',async()=>{
 assert.equal(rows.length,2);assert.equal((await q('select * from claim_event_followups(ARRAY[1],NULL,8)')).length,0);assert.equal((await q('select prepare_event_followup($1,$2,$3) v',[row.id,row.lease_token,payload]))[0].v.ok,true);assert.equal((await q('select prepare_event_followup($1,$2,$3) v',[row.id,row.lease_token,{...payload,html:'changed'}]))[0].v.payload.html,'original');assert.equal((await q('select prepare_event_followup($1,gen_random_uuid(),$2) v',[row.id,payload]))[0].v.ok,false);});
 await t.test('crashed lease recoverable, old lease cannot stamp accepted',async()=>{
 const old=row.lease_token;await q("update event_followup_outbox set lease_until=now()-interval '1 minute' where id=$1",[row.id]);row=(await q('select * from claim_event_followups(ARRAY[1],NULL,8)'))[0];assert.notEqual(row.lease_token,old);assert.equal(row.provider_payload.html,'original');assert.equal((await q("select complete_event_followup($1,$2,'sent','old',NULL) v",[row.id,old]))[0].v,false);});
 await t.test('last-moment transfer and expired provider retention stop sending',async()=>{
 await q("update tickets set user_id='new' where user_id='owner'");assert.equal((await q('select prepare_event_followup($1,$2,$3) v',[row.id,row.lease_token,payload]))[0].v.ok,false);await q("update event_followup_outbox set delivery_deadline=now()-interval '1 minute',lease_until=now()-interval '1 minute' where id=$1",[row.id]);assert.equal((await q('select * from claim_event_followups(ARRAY[1],NULL,8)')).length,0);});
 await t.test('preview is one explicit record and separate from attendee dedupe',async()=>{
 const id=(await q("select enqueue_event_followup_preview(1,'sample@example.test') id"))[0].id;assert.equal((await q("select enqueue_event_followup_preview(1,'sample@example.test') id"))[0].id,id);await q("select enqueue_event_followup_preview(1,'other@example.test')");const p=await q('select * from claim_event_followups(ARRAY[1],$1,8)',[id]);assert.equal(p.length,1);assert.equal(p[0].recipient_email,'sample@example.test');assert.equal((await q('select * from claim_event_followups(ARRAY[1],NULL,8)')).length,0);});
 await t.test('aggregate status exposes uncertain expiry, no false all-sent completion',async()=>{
 await q('select refresh_event_followup_status(ARRAY[1])');const c=(await q('select * from event_followup_campaigns where event_id=1'))[0];assert.equal(c.audience_count,2);assert.equal(c.sent_count,0);assert.equal(c.failed_count,1);assert.equal(c.status,'partial_failure');
 });
 await t.test('scoped copy overrides are plain text only and preserve unrelated campaigns',async()=>{
 const copy={subject:'How was it for you?',message:'Synthetic invitation',cta_label:'Rate the party',profile_cta_enabled:true};
 await q('select enable_event_followup_catchup(ARRAY[1],$1)',[copy]);const c=(await q('select * from event_followup_campaigns where event_id=1'))[0];assert.equal(c.subject,copy.subject);assert.equal(c.message,copy.message);assert.equal(c.profile_cta_enabled,true);assert.equal((await q('select enabled from event_followup_campaigns where event_id=2'))[0].enabled,false);
 const id=(await q("select enqueue_event_followup_preview(1,'copy@example.test',$1) id",[copy]))[0].id;assert.deepEqual((await q('select content_override from event_followup_outbox where id=$1',[id]))[0].content_override,copy);
 await assert.rejects(q('select validate_event_followup_content($1)',[{html:'<p>unsafe</p>'}]),/Invalid/);await assert.rejects(q('select validate_event_followup_content($1)',[{profile_cta_enabled:'yes'}]),/Invalid/);await assert.rejects(q('select validate_event_followup_content($1)',[{message:'x'.repeat(3001)}]),/Invalid/);
 });
 await t.test('all new RPCs service-only',async()=>{
 const funcs=await q("select oid::regprocedure::text sig from pg_proc where pronamespace='public'::regnamespace and proname like '%event_followup%'");for(const f of funcs)for(const role of ['anon','authenticated'])assert.equal((await q("select has_function_privilege($1,$2,'EXECUTE') v",[role,f.sig]))[0].v,false);});
 }finally{await db.close()}
});
