const {test}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const {randomUUID}=require('node:crypto');
const path=require('node:path');
const {PGlite}=require('@electric-sql/pglite');
const read=name=>readFileSync(path.join(__dirname,'../../migrations',name),'utf8');
test('real checkout receipt SQL preserves exact future-only ownership and recovery',async t=>{
 const db=new PGlite();const one=async(q,args=[])=>Object.values((await db.query(q,args)).rows[0])[0];
 try {
 await db.exec(`
 CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
 CREATE TABLE events (id integer primary key);
 CREATE TABLE "user" (id text primary key,email text,"emailVerified" boolean);
 CREATE TABLE carts (id uuid primary key,user_id text,event_id integer,status text,stripe_pi_id text,total_cents integer);
 CREATE TABLE orders (id uuid primary key,cart_id uuid unique,user_id text,event_id integer,
   stripe_payment_intent_id text,type text,status text,guest_email text,paid_at timestamptz,refunded_at timestamptz,total_cents integer);
 CREATE TABLE cart_line_items(id uuid primary key,cart_id uuid,tier_id uuid,quantity integer,refunded_amount_cents integer default 0);
 CREATE TABLE tickets(id uuid primary key,event_id integer,user_id text,guest_email text,status text,cart_id uuid,
   order_id uuid,ticket_type_id uuid,cart_line_item_id uuid,stripe_payment_intent_id text);
 INSERT INTO events VALUES(7); INSERT INTO "user" VALUES('member','member@example.test',true);
 `);
 await db.exec(read('20261030215857_durable_ticket_receipts.sql'));
 await db.exec(read('20261125103000_web_member_purchase_receipts.sql'));
 async function fixture({marked=true,complete=true,qty=2,ticketed=true}={}){
  const cart=randomUUID(),order=randomUUID(),tier=randomUUID(),line=randomUUID(),pi='pi_'+randomUUID();
  await db.query("INSERT INTO carts VALUES($1,'member',7,'paying',$2,2000)",[cart,pi]);
  await db.query("INSERT INTO orders VALUES($1,$2,'member',7,$3,'event_ticket','payment_pending',NULL,NULL,NULL,2000)",[order,cart,pi]);
  await db.query("INSERT INTO cart_line_items(id,cart_id,tier_id,quantity) VALUES($1,$2,$3,$4)",[line,cart,ticketed?tier:null,qty]);
  const mark=(payment=pi,buyer='member')=>one('SELECT mark_v1_web_member_purchase_receipt($1,$2,$3)',[cart,payment,buyer]);
  if(marked) assert.equal(await mark(),true);
  if(complete){
    await db.query("UPDATE carts SET status='completed' WHERE id=$1",[cart]);
    await db.query("UPDATE orders SET status='paid',paid_at=now() WHERE id=$1",[order]);
  }
  const ids=[];
  for(let i=0;ticketed&&i<qty;i++){
    const id=randomUUID();ids.push(id);
    await db.query("INSERT INTO tickets VALUES($1,7,'member',NULL,'active',$2,$3,$4,$5,$6)",[id,cart,order,tier,line,pi]);
  }
  return{ids,cart,order,tier,line,pi,mark,enqueue:(payment=pi)=>one('SELECT enqueue_v1_web_member_purchase_receipt($1,$2)',[cart,payment])};
 }
 await t.test('paid web mark yields one immutable receipt for the exact cart order and full ticket set',async()=>{
   const f=await fixture(); const id=await f.enqueue();assert.ok(id);assert.equal(await f.enqueue(),id);
   const {rows:[r]}=await db.query('SELECT * FROM ticket_receipt_outbox WHERE id=$1',[id]);
   assert.equal(r.source_kind,'web_member_purchase');assert.equal(r.source_id,f.order);assert.equal(r.recipient_auth_id,'member');assert.equal(r.guest_email,null);
   assert.deepEqual(r.ticket_ids,[...f.ids].sort());
   const claim=(await db.query('SELECT * FROM claim_ticket_receipts(25,ARRAY[$1::uuid])',[id])).rows[0];
   const payload={to:'other@example.test',from:'test',subject:'test',html:'test',ticket_ids:[...f.ids].sort()};
   assert.equal((await one('SELECT prepare_ticket_receipt($1,$2,$3)',[id,claim.lease_token,payload])).ok,false);
   payload.to='member@example.test';assert.equal((await one('SELECT prepare_ticket_receipt($1,$2,$3)',[id,claim.lease_token,payload])).ok,true);
 });
 await t.test('legacy, unpaid, wrong PI/user, and guest cannot be enrolled or emailed',async()=>{
   const legacy=await fixture({marked:false});assert.equal(await legacy.enqueue(),null);assert.equal(await legacy.mark(),false);
   const unpaid=await fixture({marked:false,complete:false});
   assert.equal(await unpaid.mark('pi_wrong'),false);assert.equal(await unpaid.mark(unpaid.pi,'other'),false);
   assert.equal(await unpaid.mark(),true);assert.equal(await unpaid.mark(),true);
   assert.equal(await unpaid.enqueue(),null);assert.equal(await unpaid.enqueue('pi_wrong'),null);
   const guest=await fixture({marked:false,complete:false});await db.query("UPDATE orders SET guest_email='guest@example.test' WHERE id=$1",[guest.order]);assert.equal(await guest.mark(),false);
 });
 await t.test('lost ownership, partial refund, wrong order, and merchandise-only carts cannot send',async()=>{
   const moved=await fixture();await db.query("UPDATE tickets SET user_id='other' WHERE id=$1",[moved.ids[0]]);assert.equal(await moved.enqueue(),null);
   const refunded=await fixture();await db.query("UPDATE cart_line_items SET refunded_amount_cents=100 WHERE id=$1",[refunded.line]);assert.equal(await refunded.enqueue(),null);
   const wrong=await fixture();await db.query("UPDATE tickets SET order_id=$2 WHERE id=$1",[wrong.ids[0],randomUUID()]);assert.equal(await wrong.enqueue(),null);
   const merch=await fixture({ticketed:false});assert.equal(await merch.enqueue(),null);
 });
 await t.test('bounded recovery after issuance crash is idempotent and cannot send historical unmarked carts',async()=>{
   const fresh=await fixture();const legacy=await fixture({marked:false});
   const sweep=()=>db.query('SELECT recover_v1_web_member_purchase_receipts(25)');
   await sweep();await sweep();
   assert.equal(await one("SELECT count(*)::integer FROM ticket_receipt_outbox WHERE source_id=$1",[fresh.order]),1);
   assert.equal(await one("SELECT count(*)::integer FROM ticket_receipt_outbox WHERE source_id=$1",[legacy.order]),0);
 });
 await t.test('private RPCs and marker are not callable/readable by clients',async()=>{
   for(const role of ['anon','authenticated']){
    assert.equal(await one("SELECT has_table_privilege($1,'web_member_purchase_receipt_intents','SELECT')",[role]),false);
    for(const sig of ['mark_v1_web_member_purchase_receipt(uuid,text,text)','enqueue_v1_web_member_purchase_receipt(uuid,text)','recover_v1_web_member_purchase_receipts(integer)'])
      assert.equal(await one("SELECT has_function_privilege($1,$2,'EXECUTE')",[role,sig]),false);
   }
 });
 } finally {await db.close()}
});
