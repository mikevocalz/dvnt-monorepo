/** Actual private RPCs in isolated synthetic PostgreSQL/WASM. No Stripe. */
const {test}=require('node:test');const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');const {resolve}=require('node:path');const {PGlite}=require('@electric-sql/pglite');
const root=resolve(__dirname,'..');
async function fixture(){const db=new PGlite();for(const p of ['scripts/fixtures/settlement/schema.sql','docs/payments/drafts/settlement-ledger.sql','docs/payments/drafts/settlement-runtime.sql','docs/payments/drafts/settlement-release-policy.sql','scripts/fixtures/settlement/approved-policy.sql'])await db.exec(readFileSync(resolve(root,p),'utf8'));await db.exec('UPDATE dvnt_settlement.controls SET checkout_enabled=true');return db;}
const snapshot=(rail='create-payment-intent')=>({rail,selection:{ticket_type_id:'00000000-0000-4000-8000-0000000000ab'},order:{user_id:'fixture-buyer',event_id:1,quantity:1,currency:'usd',total_cents:11000,subtotal_cents:10000,organizer_fee_cents:500}});
const rpc=async(db,name,args)=>(await db.query(`SELECT public.${name}(${Object.keys(args).map((k,i)=>`${k}=>$${i+1}`).join(',')}) v`,Object.values(args))).rows[0].v;
const prepare=(db,s,key)=>rpc(db,'prepare_settlement_checkout',{p_snapshot:s,p_request_key:key});
const count=async db=>(await db.query('SELECT count(*)::int n FROM orders')).rows[0].n;

test('terminal status and retired_at never permit fresh-key replacement without authorization',async()=>{const db=await fixture();try{
 const s=snapshot();const first=await prepare(db,s,'fixture-guard-original');
 const before=(await db.query('SELECT * FROM orders')).rows[0];
 for(const status of ['created','payment_pending','payment_failed','canceled','cancelled','failed','refunded','partially_refunded','disputed',null,'unknown']){
  await db.query('UPDATE orders SET status=$1 WHERE id=$2',[status,first.order_id]);
  await db.query('UPDATE dvnt_settlement.checkouts SET retired_at=now() WHERE order_id=$1',[first.order_id]);
  await assert.rejects(prepare(db,s,'fixture-new-key-'+String(status)),/existing checkout requires reconciliation/);
 }
 assert.equal(await count(db),1);const after=(await db.query('SELECT * FROM orders')).rows[0];delete before.status;delete after.status;assert.deepEqual(after,before);
}finally{await db.close();}});

test('hosted, guest-capable hosted and native ticket rails share the same pending-selection guard',async()=>{const db=await fixture();try{
 const original=await prepare(db,snapshot(),'fixture-guard-native');
 for(const rail of ['ticket-checkout','guest-checkout','create-payment-intent']){const s=snapshot(rail);s.order.quantity=2;await assert.rejects(prepare(db,s,'fixture-switch-'+rail),/existing checkout requires reconciliation/);}
 assert.equal(await count(db),1);assert.equal((await prepare(db,snapshot(),'fixture-guard-native')).order_id,original.order_id);
}finally{await db.close();}});

test('a new cart line ID or quantity cannot disguise the same pending ticket selection',async()=>{const db=await fixture();try{
 await prepare(db,snapshot(),'fixture-guard-ticket');
 const s=snapshot('cart-checkout');s.selection={lines:[{id:'new-line',tier_id:'00000000-0000-4000-8000-0000000000ab',addon_id:null,variant_id:null,quantity:3}]};
 await assert.rejects(prepare(db,s,'fixture-cart-switch'),/existing checkout requires reconciliation/);
 s.selection.lines[0].tier_id='00000000-0000-4000-8000-0000000000cd';await prepare(db,s,'fixture-cart-distinct');assert.equal(await count(db),2);
}finally{await db.close();}});

test('cart-to-native and reordered cart clones cannot bypass overlapping catalog selections',async()=>{const db=await fixture();try{
 const s=snapshot('cart-checkout');s.selection={lines:[{id:'line-a',tier_id:'00000000-0000-4000-8000-0000000000ab',quantity:1},{id:'line-b',addon_id:'00000000-0000-4000-8000-0000000000ef',variant_id:'00000000-0000-4000-8000-0000000000a1',quantity:1}]};
 await prepare(db,s,'fixture-cart-original');await assert.rejects(prepare(db,snapshot(),'fixture-native-switch'),/existing checkout requires reconciliation/);
 const clone=structuredClone(s);clone.selection.lines.reverse();clone.selection.lines.forEach((l,i)=>l.id='clone-'+i);
 await assert.rejects(prepare(db,clone,'fixture-cart-cloned'),/existing checkout requires reconciliation/);
 assert.equal(await count(db),1);
}finally{await db.close();}});

test('same-item guest retries normalize email but cannot replay capabilities or cross into a member identity',async()=>{const db=await fixture();try{
 const s=snapshot('guest-checkout');delete s.order.user_id;s.order.guest_email='buyer@example.invalid';await prepare(db,s,'fixture-guest-original');
 await assert.rejects(prepare(db,s,'fixture-guest-original'),/guest replay requires secure recovery/);
 const switched=structuredClone(s);switched.rail='ticket-checkout';switched.order.guest_email='BUYER@example.invalid';
 await assert.rejects(prepare(db,switched,'fixture-guest-switch'),/existing checkout requires reconciliation/);
 // Another authenticated buyer is not authorized to read/replay a guest order;
 // their ordinary independent purchase remains possible and gets another ID.
 const own=await prepare(db,snapshot(),'fixture-independent-member');assert.ok(own.order_id);assert.equal(await count(db),2);
}finally{await db.close();}});

test('unrelated buyers/selections and completed paid repeat purchases remain possible',async()=>{const db=await fixture();try{
 const first=await prepare(db,snapshot(),'fixture-guard-first');
 const other=snapshot();other.order.user_id='another-buyer';await prepare(db,other,'fixture-guard-other');
 const different=snapshot('ticket-checkout');different.selection.ticket_type_id='00000000-0000-4000-8000-0000000000cd';await prepare(db,different,'fixture-guard-different');
 await db.query("UPDATE orders SET status='paid',paid_at=now() WHERE id=$1",[first.order_id]);
 await prepare(db,snapshot('ticket-checkout'),'fixture-guard-repeat-paid');assert.equal(await count(db),4);
}finally{await db.close();}});

test('equivalent PostgreSQL UUID spellings remain the same catalog selection',async()=>{const db=await fixture();try{
 await prepare(db,snapshot(),'fixture-uuid-original');
 for(const id of ['00000000-0000-4000-8000-0000000000AB','00000000-0000-4000-8000-0000000000ab'.replaceAll('-', ''),'{00000000-0000-4000-8000-0000000000ab}']){
  const s=snapshot('ticket-checkout');s.selection.ticket_type_id=id;
  await assert.rejects(prepare(db,s,'fixture-uuid-'+id),/existing checkout requires reconciliation/);
 }
 for(const key of ['tier_id','addon_id']){
  const canonical={lines:[{[key]:'00000000-0000-4000-8000-0000000000ab',...(key==='addon_id'?{variant_id:'00000000-0000-4000-8000-0000000000ef'}:{})}]};
  const spelled=JSON.parse(JSON.stringify(canonical).replaceAll('00000000-0000-4000-8000-0000000000ab','00000000-0000-4000-8000-0000000000ab'.replaceAll('-', '').toUpperCase()).replaceAll('00000000-0000-4000-8000-0000000000ef','{00000000-0000-4000-8000-0000000000EF}'));
  assert.equal((await db.query('SELECT dvnt_settlement.checkout_selections_overlap($1,$2) v',[canonical,spelled])).rows[0].v,true);
 }
 assert.equal(await count(db),1);
}finally{await db.close();}});

test('unknown selection shapes fail closed and the private matcher is not caller-executable',async()=>{const db=await fixture();try{
 await prepare(db,snapshot(),'fixture-selection-original');
 for(const selection of [null,{},[],{lines:null},{lines:[null]},{lines:[{tier_id:'t',addon_id:'a'}]}]){const s=snapshot('ticket-checkout');s.selection=selection;await assert.rejects(prepare(db,s,'fixture-malformed-'+Math.random().toString(16)),/existing checkout requires reconciliation/);}
 for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);await assert.rejects(db.query("SELECT dvnt_settlement.checkout_selections_overlap('{}','{}')"),/permission/);await db.exec('RESET ROLE');}
}finally{await db.close();}});
