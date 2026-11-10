// Executes the actual allocator definitions and contact migration in PGlite.
// Hold admission is a fixture; this tests contact persistence/replays, not races.
const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {PGlite}=require('@electric-sql/pglite');const root=path.resolve(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,'apps/mobile/supabase/migrations',name),'utf8');
const patch=read('20261110025900_guest_ticket_contact_capture.sql');
async function setup(){
 const db=new PGlite();
 const harness=fs.readFileSync(path.join(__dirname,'verify-paid-ticket-issuance.mjs'),'utf8');
 const schema=harness.split('  await sql(`')[1].split('`);')[0];await db.exec(schema);
 await db.exec(`ALTER TABLE tickets ADD COLUMN guest_phone text; ALTER TABLE orders ADD COLUMN guest_phone text;
 ALTER TABLE ticket_types ADD COLUMN is_sold_out boolean DEFAULT false; ALTER TABLE ticket_types ADD COLUMN max_per_order integer; ALTER TABLE ticket_types ADD COLUMN category text DEFAULT 'admission';
 CREATE FUNCTION ticket_buyer_reserved_quantity(uuid,text,text) RETURNS bigint LANGUAGE sql AS $$SELECT 0::bigint$$;
 CREATE FUNCTION ticket_purchase_hold_atomic(uuid,integer,text,text,text,integer,text) RETURNS jsonb LANGUAGE sql AS $$SELECT '{"ok":true}'::jsonb$$;`);
 const repeat=read('20261031142216_repeat_purchase_tier_limits.sql');
 const free=repeat.slice(repeat.indexOf('CREATE OR REPLACE FUNCTION public.free_ticket_checkout_atomic('),repeat.indexOf('-- Retain the deployed guest-only entrypoint'));
 await db.exec(free);await db.exec(read('20261021144500_paid_ticket_issuance_atomic.sql').split('-- Expired reservations')[0]);
 return db;
}
test('contact migration persists free/paid phones and preserves replay identity',async()=>{
 const db=await setup();try{
 await db.exec(patch);
 const signatures=['public.free_ticket_checkout_atomic(uuid,jsonb,jsonb)','public.paid_ticket_issuance_atomic(uuid,uuid,text,text,bigint,jsonb)'];
 for(const signature of signatures){const text=(await db.query('select pg_get_functiondef($1::regprocedure) as body',[signature])).rows[0].body;assert.match(text,/guest_name, guest_phone, attendee_name/);}
 await db.exec("INSERT INTO events(id) VALUES(1)");
 const freeTier=randomUUID(),paidTier=randomUUID();await db.query('INSERT INTO ticket_types(id,event_id,price_cents) VALUES($1,1,0),($2,1,500)',[freeTier,paidTier]);
 const ticket=(tier,extra={})=>({id:randomUUID(),event_id:1,ticket_type_id:tier,user_id:null,guest_email:'guest@fixture.test',guest_name:'Guest',guest_phone:'+12125550123',qr_token:randomUUID(),qr_payload:'fixture',guest_lookup_token:randomUUID(),...extra});
 const freeRows=[ticket(freeTier)];const order={guest_email:'guest@fixture.test',guest_phone:'+12125550123',quantity:1,total_cents:0,subtotal_cents:0,event_id:1,expected_unit_price_cents:0,idempotency_key:'contact-free'};
 const issueFree=()=>db.query('SELECT free_ticket_checkout_atomic($1,$2,$3) AS result',[freeTier,JSON.stringify(freeRows),JSON.stringify(order)]);
 let result=(await issueFree()).rows[0].result;assert.equal(result.ok,true,JSON.stringify(result));
 assert.equal((await issueFree()).rows[0].result.idempotent,true);
 const paidOrder=randomUUID();await db.query("INSERT INTO orders(id,guest_email,guest_phone,type,status,event_id,quantity,total_cents,stripe_checkout_session_id) VALUES($1,'guest@fixture.test','+12125550123','event_ticket','paid',1,1,500,'cs_contact')",[paidOrder]);
 const paidRows=[ticket(paidTier,{order_id:paidOrder,purchase_amount_cents:500,stripe_payment_intent_id:'pi_contact',stripe_checkout_session_id:'cs_contact'})];
 const issuePaid=()=>db.query("SELECT paid_ticket_issuance_atomic($1,$2,'pi_contact','cs_contact',500,$3) AS result",[paidOrder,paidTier,JSON.stringify(paidRows)]);
 await db.query("INSERT INTO ticket_holds(ticket_type_id,event_id,quantity,payment_intent_id,guest_email,expires_at) VALUES($1,1,1,'cs_contact','guest@fixture.test',now()+interval '1 hour')",[paidTier]);
 result=(await issuePaid()).rows[0].result;assert.equal(result.ok,true,JSON.stringify(result));assert.equal((await issuePaid()).rows[0].result.duplicate,true);
 const rows=(await db.query('SELECT guest_phone,user_id FROM tickets')).rows;assert.equal(rows.length,2);assert.ok(rows.every(t=>t.guest_phone==='+12125550123'&&t.user_id===null));
 assert.equal((await db.query("SELECT guest_phone FROM orders WHERE idempotency_key='contact-free'")).rows[0].guest_phone,'+12125550123');
 // Rerun refuses rather than mutating an unexpected/already-patched allocator.
 await assert.rejects(db.exec(patch),/Unexpected allocator/);await db.exec('ROLLBACK');
 assert.equal((await db.query('SELECT count(*)::int AS n FROM tickets')).rows[0].n,2);
 }finally{await db.close();}
});
