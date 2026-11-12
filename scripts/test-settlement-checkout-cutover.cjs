const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const vm=require('node:vm');const ts=require('typescript');const {PGlite}=require('@electric-sql/pglite');
const ROOT=path.resolve(__dirname,'..');const read=p=>fs.readFileSync(path.join(ROOT,p),'utf8');
async function fixture(){const db=new PGlite();for(const p of ['scripts/fixtures/settlement/schema.sql','docs/payments/drafts/settlement-ledger.sql','docs/payments/drafts/settlement-runtime.sql','docs/payments/drafts/settlement-release-policy.sql','docs/payments/drafts/settlement-checkout-cutover.sql'])await db.exec(read(p));await db.exec("INSERT INTO events VALUES(2,'fixture-host','2020-01-01','pending','2019-12-30','published','2019-12-29')");return db;}
const rpc=async(db,name,args)=>(await db.query(`SELECT public.${name}(${Object.keys(args).map((k,i)=>`${k}=>$${i+1}`).join(',')}) v`,Object.values(args))).rows[0].v;
const route=(db,event=1)=>rpc(db,'settlement_checkout_route',{p_event_id:event});
function adapter(enabled){const exports={};vm.runInNewContext(ts.transpileModule(read('apps/mobile/supabase/functions/_shared/settlement-checkout.ts'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,Number,Error,Deno:{env:{get:()=>enabled?'true':'false'}}});return exports.prepareSettlementCheckout;}
const snap=(event=1,rail='create-payment-intent')=>({rail,selection:{ticket_type_id:'00000000-0000-4000-8000-00000000000a'},order:{user_id:'fixture-buyer',event_id:event,quantity:1,currency:'usd',subtotal_cents:1000,total_cents:1125,organizer_fee_cents:125}});
test('default-off schema preserves never-cutover legacy events; explicit reviewed cohort permanently fences only that event',async()=>{const db=await fixture();try{
 assert.equal((await route(db)).charge_model,'destination_charge');assert.equal((await route(db,2)).charge_model,'destination_charge');
 await db.exec("INSERT INTO dvnt_settlement.release_policies VALUES(1,'end_plus_five_business_days','UTC','synthetic cutover review')");
 assert.equal((await route(db)).charge_model,'separate_charges_and_transfers');assert.equal((await route(db,2)).charge_model,'destination_charge');
 await db.exec('DELETE FROM dvnt_settlement.release_policies; UPDATE dvnt_settlement.controls SET checkout_enabled=false');
 assert.equal((await route(db)).charge_model,'separate_charges_and_transfers');assert.equal((await route(db,2)).charge_model,'destination_charge');
 for(const sql of ['DELETE FROM dvnt_settlement.checkout_cutovers','UPDATE dvnt_settlement.checkout_cutovers SET event_id=2','TRUNCATE dvnt_settlement.checkout_cutovers'])await assert.rejects(db.exec(sql),/permanent/);
}finally{await db.close();}});
test('real adapter rollback cannot fall through with new key, switched rail, no key or another buyer on cutover event',async()=>{const db=await fixture();try{
 await db.exec("INSERT INTO dvnt_settlement.release_policies VALUES(1,'end_plus_five_business_days','UTC','synthetic cutover review'); UPDATE dvnt_settlement.controls SET checkout_enabled=true");
 const client={rpc:async(n,a)=>{try{return {data:await rpc(db,n,a),error:null};}catch(e){return {data:null,error:{message:e.message}};}}};
 for(const rail of ['ticket-checkout','guest-checkout','create-payment-intent','cart-checkout'])for(const key of [null,'fixture-original-key','fixture-fresh-key'])await assert.rejects(adapter(false)(client,snap('01',rail),key),/paused/);
 assert.equal(await adapter(false)(client,snap(2),null),null);assert.equal(await adapter(true)(client,snap(2),null),null);
 assert.equal((await db.query('SELECT count(*)::int n FROM orders')).rows[0].n,0);
 const p=await adapter(true)(client,snap(1),'fixture-reviewed-key');assert.ok(p.orderId);
 assert.equal((await route(db)).charge_model,'separate_charges_and_transfers');
}finally{await db.close();}});
test('missing schema, stale cache, malformed route and read errors never choose a financial model',async()=>{for(const response of [{error:{code:'PGRST202'}},{error:{code:'08006'}},{data:null},{data:{ok:true}},{data:{ok:true,charge_model:'unknown'}}])for(const enabled of [false,true])await assert.rejects(adapter(enabled)({rpc:async()=>response},snap(),'fixture-request-key'),/route unavailable/);});
test('historical separate orders fence an event even without surviving cohort policy; routing and fence tables stay private',async()=>{const db=await fixture();try{
 await db.exec("INSERT INTO orders(event_id,charge_model) VALUES(2,'separate_charges_and_transfers')");assert.equal((await route(db,2)).charge_model,'separate_charges_and_transfers');
 for(const role of ['anon','authenticated','service_role']){await db.exec('SET ROLE '+role);await assert.rejects(db.exec('SELECT * FROM dvnt_settlement.checkout_cutovers'),/permission/);if(role!=='service_role')await assert.rejects(route(db),/permission/);await db.exec('RESET ROLE');}
 await assert.rejects(route(db,999),/unavailable/);await assert.rejects(route(db,null),/unavailable/);
}finally{await db.close();}});
