const {test}=require('node:test');const assert=require('node:assert/strict');const {readFileSync}=require('node:fs');const {resolve}=require('node:path');const vm=require('node:vm');const ts=require('typescript');
const {setup,engine}=require('./test-settlement-engine.cjs');const root=resolve(__dirname,'..');const exported={};
vm.runInNewContext(ts.transpileModule(readFileSync(resolve(root,'apps/mobile/supabase/functions/_shared/settlement-webhook-link.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exported,require:()=>engine,Number,Error,encodeURIComponent});
test('verified webhook links durable order before legacy lookup without inserting another order',async()=>{const f=await setup({link:false});try{
 await exported.linkSettlementWebhookPayment(f.db,f.intent,'payment_intent.succeeded',p=>f.provider.get(p));
 assert.equal((await f.candidate()).stripe_payment_intent_id,'pi_fixture');assert.equal((await f.pg.query('select count(*)::int n from orders')).rows[0].n,1);assert.equal(f.transfers.length,0);
}finally{await f.pg.close()}});
test('webhook metadata alone cannot link wrong-amount or destination-funded payment',async()=>{for(const fault of ['amount','destination']){const f=await setup({link:false});try{
 if(fault==='amount')f.intent.amount++;else f.intent.transfer_data={destination:'acct_legacy'};
 await assert.rejects(exported.linkSettlementWebhookPayment(f.db,f.intent,'payment_intent.succeeded',p=>f.provider.get(p)),/mismatch/);assert.equal((await f.candidate()).stripe_payment_intent_id,null);
}finally{await f.pg.close()}}});
test('legacy webhook stays untouched and performs no separate-order lookup',async()=>{let read=false;await exported.linkSettlementWebhookPayment({rpc:async()=>{read=true;throw Error('unexpected')}},{metadata:{}},'payment_intent.succeeded');assert.equal(read,false)});
test('verified webhook wakes an existing backed-off link without clearing an unknown marker or manual hold',async()=>{const f=await setup();try{
 await f.call('settlement_hold',{p_order_id:f.p.order_id,p_event_id:'fixture_webhook_hold',p_reason:'manual'});
 await f.call('settlement_checkout_observation',{p_order_id:f.p.order_id,p_outcome:'unknown'});
 let c=(await f.pg.query('SELECT * FROM dvnt_settlement.checkouts')).rows[0];assert.ok(c.next_check_at);assert.ok(c.outcome_unknown_since);
 await exported.linkSettlementWebhookPayment(f.db,f.intent,'payment_intent.succeeded',p=>f.provider.get(p));
 c=(await f.pg.query('SELECT * FROM dvnt_settlement.checkouts')).rows[0];assert.equal(c.next_check_at,null);assert.ok(c.outcome_unknown_since);assert.equal(c.last_error,'hold:manual');
 assert.equal((await f.call('settlement_candidates',{p_limit:100}))[0].order_id,f.p.order_id);assert.equal(f.transfers.length,0);
}finally{await f.pg.close()}});
