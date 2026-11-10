const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const root=path.resolve(__dirname,'..');
async function fixture(){const db=new PGlite();await db.exec(`
 CREATE ROLE anon;CREATE ROLE authenticated;CREATE ROLE service_role;
 CREATE TABLE events(id integer primary key,host_id text);
 CREATE TABLE event_co_organizers(event_id integer,user_id text,role text,accepted boolean);
 CREATE TABLE users(auth_id text,username text,email text);
 CREATE TABLE user_private_profile(auth_id text,phone_e164 text);
 CREATE TABLE tickets(id text,event_id integer,user_id text,guest_email text,guest_phone text,guest_phone_e164 text);
 CREATE TABLE limits(actor text,action text);
 CREATE FUNCTION check_rate_limit(text,text,text,integer,integer) RETURNS boolean LANGUAGE sql AS $$SELECT count(*)<$4 FROM limits WHERE actor=$1 AND action=$2$$;
 CREATE FUNCTION record_rate_limit(text,text,text) RETURNS void LANGUAGE sql AS $$INSERT INTO limits VALUES($1,$2)$$;
 INSERT INTO events VALUES(1,'owner'),(2,'other');
 INSERT INTO event_co_organizers VALUES(1,'scanner','scanner',true),(1,'pending','scanner',false),(1,'wrong','viewer',true);
 INSERT INTO users VALUES('member','known','member@example.com');
 INSERT INTO user_private_profile VALUES('member','+12125550123');
 INSERT INTO tickets VALUES('one',1,'member',NULL,NULL,NULL),('two',2,'member',NULL,NULL,NULL),('guest',1,NULL,'guest@example.com','+12125550999',NULL),('transferred',1,'member','old@example.com','+12125550000',NULL),('comp',1,NULL,NULL,NULL,'+12125550888');
 `);await db.exec(fs.readFileSync(path.join(root,'apps/mobile/supabase/migrations/20261110030000_event_ticket_contact_lookup.sql'),'utf8'));return db;}
async function lookup(db,actor,kind,value,event=1){return (await db.query('SELECT id FROM lookup_event_tickets_contact($1,$2,$3,$4) ORDER BY id',[event,actor,kind,value])).rows.map(x=>x.id);}
test('exact staff contact lookup is event scoped and uses current holder contact, not transferred purchaser',async()=>{const db=await fixture();try{
 assert.deepEqual(await lookup(db,'scanner','email',' MEMBER@example.com '),['one','transferred']);
 assert.deepEqual(await lookup(db,'scanner','phone','+12125550123'),['one','transferred']);
 assert.deepEqual(await lookup(db,'owner','email','guest@example.com'),['guest']);
 assert.deepEqual(await lookup(db,'scanner','phone','+12125550999'),['guest']);
 assert.deepEqual(await lookup(db,'scanner','phone','+12125550888'),['comp']);
 assert.deepEqual(await lookup(db,'scanner','email','old@example.com'),[]);
 assert.deepEqual(await lookup(db,'scanner','phone','+12125550000'),[]);
 assert.deepEqual(await lookup(db,'scanner','email','%@example.com'),[]);
 assert.deepEqual(await lookup(db,'scanner','email','member_@example.com'),[]);
 for(const actor of ['stranger','pending','wrong',''])await assert.rejects(lookup(db,actor,'email','member@example.com'),/Not authorized/);
 await assert.rejects(lookup(db,'scanner','email','member@example.com',2),/Not authorized/);
 await assert.rejects(lookup(db,'scanner','email','member'),/complete email/);
 await assert.rejects(lookup(db,'scanner','phone','5550123'),/complete phone/);
 await assert.rejects(lookup(db,'scanner','bogus','member@example.com'),/Unknown contact/);
 }finally{await db.close();}});
test('RPC is service-only and shared rate budget excludes raw contact values',async()=>{const db=await fixture();try{
 const acl=(await db.query(`SELECT has_function_privilege('anon','lookup_event_tickets_contact(integer,text,text,text)','EXECUTE') anon,has_function_privilege('authenticated','lookup_event_tickets_contact(integer,text,text,text)','EXECUTE') auth,has_function_privilege('service_role','lookup_event_tickets_contact(integer,text,text,text)','EXECUTE') service`)).rows[0];
 assert.deepEqual(acl,{anon:false,auth:false,service:true});
 for(let i=0;i<30;i++)await lookup(db,'scanner','email','guest@example.com');
 await assert.rejects(lookup(db,'scanner','email','other@example.com'),/limit reached/);
 assert.deepEqual((await db.query('SELECT DISTINCT actor,action FROM limits')).rows,[{actor:'scanner',action:'ticket_contact:1'}]);
 }finally{await db.close();}});
test('endpoint keeps every contact response PII-minimized and does not log contact failures',()=>{const src=fs.readFileSync(path.join(root,'apps/mobile/supabase/functions/get-event-tickets/index.ts'),'utf8');assert.match(src,/if \(isScanner \|\| contact\)/);assert.match(src,/if \(contact\) \{[\s\S]*?return errorResponse[\s\S]*?console.error/);assert.match(src,/verifySession/);});
