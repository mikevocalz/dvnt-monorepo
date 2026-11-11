const {test}=require('node:test');const assert=require('node:assert/strict');const {readFileSync}=require('node:fs');const {resolve}=require('node:path');
const vm=require('node:vm');const ts=require('typescript');const {PGlite}=require('@electric-sql/pglite');
const root=resolve(__dirname,'..');const exportsObject={};
vm.runInNewContext(ts.transpileModule(readFileSync(resolve(root,'apps/mobile/supabase/functions/_shared/settlement-engine.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsObject,Date,Set,Number,Error,encodeURIComponent});
const {processSettlementOrder}=exportsObject;
async function setup({link=true}={}){
 const pg=new PGlite();for(const p of ['scripts/fixtures/settlement/schema.sql','docs/payments/drafts/settlement-ledger.sql','docs/payments/drafts/settlement-runtime.sql'])await pg.exec(readFileSync(resolve(root,p),'utf8'));
 const db={failRecord:false,async rpc(name,args){if(name==='settlement_reconcile_transfer'&&this.failRecord){this.failRecord=false;return {data:null,error:{message:'fixture commit failed'}}}try{const keys=Object.keys(args);const {rows}=await pg.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) v`,Object.values(args));return {data:rows[0].v,error:null}}catch(e){return {data:null,error:{message:e.message}}}}};
 async function call(n,a){const r=await db.rpc(n,a);if(r.error)throw Error(r.error.message);return r.data}
 await pg.exec('update dvnt_settlement.controls set checkout_enabled=true,transfers_enabled=true,release_delay_seconds=86400');
 const snapshot={rail:'create-payment-intent',selection:{ticket_type_id:'fixture-tier'},order:{user_id:'fixture-buyer',event_id:1,quantity:1,currency:'usd',total_cents:11000,subtotal_cents:10000,organizer_fee_cents:500,platform_fee_cents:1000,dvnt_total_fee_cents:1000,promoter_code:'FIXTURE',promoter_commission_amount_cents:1000,promoter_commission_bps:1000,promoter_customer_discount_bps:0}};
 const p=await call('prepare_settlement_checkout',{p_snapshot:snapshot,p_request_key:'fixture-request-engine'});
 await call('claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:'11000'}});
 if(link)await call('finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_fixture',p_checkout_session_id:null});
 const metadata={settlement_order_id:p.order_id,charge_model:'separate_charges_and_transfers'};
 const intent={id:'pi_fixture',status:'succeeded',amount:11000,amount_received:11000,currency:'usd',latest_charge:'ch_fixture',metadata,transfer_data:null,application_fee_amount:null};
 const charge={id:'ch_fixture',created:100,payment_intent:'pi_fixture',amount:11000,amount_captured:11000,currency:'usd',paid:true,captured:true,status:'succeeded',refunded:false,amount_refunded:0,disputed:false,transfer:null,transfer_data:null,application_fee:null,application_fee_amount:null,balance_transaction:{status:'available',currency:'usd',amount:11000,fee:500,net:10500}};
 const transfers=[];const requests=[];let available=100000;let networkFailure=false;let afterPost;
 const provider={async get(path){requests.push(['GET',path]);if(path.startsWith('/v1/payment_intents/'))return structuredClone(intent);if(path.startsWith('/v1/charges/'))return structuredClone(charge);
 if(path.startsWith('/v1/transfers?'))return {data:structuredClone(transfers),has_more:false};
 if(path==='/v1/balance')return {available:[{currency:'usd',amount:available}]};
 if(path.startsWith('/v2/core/accounts/')){const id=path.split('/')[4].split('?')[0];return {id,metadata:id==='acct_host'?{dvnt_host_id:'fixture-host'}:{dvnt_promoter_id:'00000000-0000-4000-8000-000000000002'},configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:'active'}}}}}}}
 throw Error('Unexpected read '+path)},async post(path,body,key){requests.push(['POST',path,body,key]);assert.equal(path,'/v1/transfers');const t={id:'tr_fixture_'+transfers.length,amount:Number(body.amount),currency:body.currency,destination:body.destination,source_transaction:body.source_transaction,transfer_group:body.transfer_group,metadata:{settlement_order_id:body['metadata[settlement_order_id]'],settlement_allocation_id:body['metadata[settlement_allocation_id]']},reversed:false,amount_reversed:0};transfers.push(t);available-=t.amount;if(afterPost)await afterPost(t);if(networkFailure){networkFailure=false;throw Error('fixture lost response')}return structuredClone(t)}};
 const candidate=()=>call('settlement_order',{p_order_id:p.order_id});const run=async(execute=true)=>processSettlementOrder(db,provider,await candidate(),{execute});
 return {pg,db,call,provider,candidate,run,p,charge,intent,transfers,requests,setBalance:n=>available=n,loseResponse:()=>networkFailure=true,setAfterPost:f=>afterPost=f};
}

test('actual SQL + fake Stripe: full host transfer, late promoter onboarding, replay and distinct bank status',async()=>{const f=await setup();try{
 const first=await f.run();assert.equal(first.transferred,1);assert.equal(f.transfers.length,1);
 let state=await f.candidate();assert.equal(state.allocations.find(a=>a.role==='promoter').state,'held');
 await f.pg.exec("update event_promoters set stripe_account_id='acct_promoter'");await f.run();assert.equal(f.transfers.length,2);await f.run();assert.equal(f.transfers.length,2);
 assert.ok((await f.pg.query('select bank_payout_state from dvnt_settlement.deliveries')).rows.every(r=>r.bank_payout_state==='unverified'));
}finally{await f.pg.close()}});

test('lost transfer response reconciles unique exact transfer without sending twice',async()=>{const f=await setup();try{f.loseResponse();await f.run();assert.equal(f.transfers.length,1);assert.equal((await f.candidate()).allocations.find(a=>a.role==='organizer').state,'uncertain');await f.run();assert.equal(f.transfers.length,1);assert.equal((await f.candidate()).allocations.find(a=>a.role==='organizer').state,'transferred');}finally{await f.pg.close()}});

test('DB failure after provider success quarantines then reconciles without duplicate',async()=>{const f=await setup();try{f.db.failRecord=true;await f.run();assert.equal(f.transfers.length,1);assert.equal((await f.candidate()).allocations.find(a=>a.role==='organizer').state,'uncertain');await f.run();assert.equal(f.transfers.length,1);}finally{await f.pg.close()}});

test('repeated overlapping workers dispatch each allocation at most once',async()=>{const f=await setup();try{await Promise.all([f.run(),f.run()]);assert.equal(f.transfers.length,1);}finally{await f.pg.close()}});

test('negative funds, incomplete capability and destination-funded source never dispatch',async()=>{for(const fault of ['negative','destination','capability']){const f=await setup();try{
 if(fault==='negative')f.setBalance(-1);if(fault==='destination')f.charge.transfer='tr_historical';if(fault==='capability'){const get=f.provider.get;f.provider.get=async p=>p.startsWith('/v2/')?{id:'acct_host'}:get(p)}
 try{await f.run()}catch{}assert.equal(f.transfers.length,0);
}finally{await f.pg.close()}}});

test('untracked previous transfer from source prevents funding even when metadata claims separate',async()=>{const f=await setup();try{f.transfers.push({id:'tr_other',source_transaction:'ch_fixture',metadata:{},amount:1});await f.run();assert.equal(f.requests.filter(r=>r[0]==='POST').length,0);}finally{await f.pg.close()}});

test('refund racing with provider success records recovery obligation and blocks new allocation',async()=>{const f=await setup();try{
 await f.pg.exec("update event_promoters set stripe_account_id='acct_promoter'");f.setAfterPost(async()=>{await f.call('settlement_hold',{p_order_id:f.p.order_id,p_event_id:'re_race',p_reason:'refund'});f.charge.refunded=true;f.charge.amount_refunded=11000});
 await f.run();assert.equal(f.transfers.length,1);assert.equal((await f.candidate()).allocations.filter(a=>a.state==='recovery_required').length,1);
}finally{await f.pg.close()}});

test('execute=false verifies source but creates no transfer or reservation',async()=>{const f=await setup();try{await f.run(false);assert.equal(f.transfers.length,0);assert.ok((await f.candidate()).allocations.every(a=>a.state==='held'));}finally{await f.pg.close()}});
module.exports={setup,engine:exportsObject};
