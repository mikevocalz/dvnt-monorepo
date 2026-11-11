const {test}=require('node:test');const assert=require('node:assert/strict');const {readFileSync}=require('node:fs');const {resolve}=require('node:path');
const vm=require('node:vm');const ts=require('typescript');const {PGlite}=require('@electric-sql/pglite');
const root=resolve(__dirname,'..');const exportsObject={};const fundingExports={};
vm.runInNewContext(ts.transpileModule(readFileSync(resolve(root,'apps/mobile/supabase/functions/_shared/settlement-funding.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:fundingExports,Date,Set,Number,Error,encodeURIComponent});
vm.runInNewContext(ts.transpileModule(readFileSync(resolve(root,'apps/mobile/supabase/functions/_shared/settlement-engine.ts'),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports:exportsObject,Date,Set,Number,Error,encodeURIComponent,require:p=>{assert.equal(p,'./settlement-funding.ts');return fundingExports}});
const {processSettlementOrder}=exportsObject;
const {sourceSchemaSql}=require('./fixtures/settlement/replacement-source-schema.cjs');
const {issuePaidOrder,fixtureTier}=require('./fixtures/settlement/issuance.cjs');
async function setup({link=true,onboard=true,defaultGrants=false,issue=true,installGate=true}={}){
 const pg=new PGlite();
 await pg.exec(readFileSync(resolve(root,'scripts/fixtures/settlement/schema.sql'),'utf8'));
 if(defaultGrants)await pg.exec('ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon,authenticated,service_role; ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon,authenticated,service_role');
 await pg.exec(readFileSync(resolve(root,'scripts/fixtures/settlement/external-schema.sql'),'utf8'));
 await pg.exec(sourceSchemaSql());
 let artifact=readFileSync(resolve(root,'apps/mobile/supabase/migrations/20261111040111_settlement_runtime_v1.sql'),'utf8');
 // Historical scheduler fixtures alone seed old liabilities before installing
 // the final gate. Ordinary engine/endpoint cases run the unmodified artifact.
 if(!installGate){const gate=readFileSync(resolve(root,'docs/payments/drafts/settlement-fulfillment.sql'),'utf8');artifact=artifact.replace(gate.trim().replace(/^BEGIN;\s*$/m,'').replace(/^COMMIT;\s*$/m,''),'');}
 await pg.exec(artifact);
 await pg.exec(readFileSync(resolve(root,'scripts/fixtures/settlement/approved-policy.sql'),'utf8'));
 const db={failRecord:false,async rpc(name,args){if(name==='settlement_reconcile_transfer'&&this.failRecord){this.failRecord=false;return {data:null,error:{message:'fixture commit failed'}}}try{const keys=Object.keys(args);const {rows}=await pg.query(`select public.${name}(${keys.map((k,i)=>`${k}=>$${i+1}`).join(',')}) v`,Object.values(args));return {data:rows[0].v,error:null}}catch(e){return {data:null,error:{message:e.message}}}}};
 async function call(n,a){const r=await db.rpc(n,a);if(r.error)throw Error(r.error.message);return r.data}
 await pg.exec("insert into dvnt_settlement.funding_policy values(true,'acct_platform_fixture',false,0,'synthetic fixture only'); update dvnt_settlement.controls set checkout_enabled=true,transfers_enabled=true,release_delay_seconds=86400; insert into dvnt_settlement.currency_reserves values('usd',0,'synthetic fixture only')");
 if(onboard)await pg.exec("update event_promoters set stripe_account_id='acct_promoter'");
 const snapshot={rail:'create-payment-intent',selection:{ticket_type_id:fixtureTier},order:{user_id:'fixture-buyer',event_id:1,quantity:1,currency:'usd',total_cents:11000,subtotal_cents:10000,organizer_fee_cents:500,platform_fee_cents:1000,dvnt_total_fee_cents:1000,promoter_code:'FIXTURE',promoter_commission_amount_cents:1000,promoter_commission_bps:1000,promoter_customer_discount_bps:0}};
 const p=await call('prepare_settlement_checkout',{p_snapshot:snapshot,p_request_key:'fixture-request-engine'});
 await call('claim_settlement_checkout',{p_order_id:p.order_id,p_params:{amount:'11000'}});
 if(link)await call('finalize_settlement_checkout',{p_order_id:p.order_id,p_payment_intent_id:'pi_fixture',p_checkout_session_id:null});
 if(link&&issue)await issuePaidOrder(pg,p.order_id);
 const metadata={settlement_order_id:p.order_id,charge_model:'separate_charges_and_transfers'};
 const intent={id:'pi_fixture',status:'succeeded',amount:11000,amount_received:11000,currency:'usd',latest_charge:'ch_fixture',metadata,transfer_data:null,application_fee_amount:null};
 const charge={id:'ch_fixture',created:100,payment_intent:'pi_fixture',amount:11000,amount_captured:11000,currency:'usd',paid:true,captured:true,status:'succeeded',refunded:false,amount_refunded:0,disputed:false,transfer:null,transfer_data:null,application_fee:null,application_fee_amount:null,balance_transaction:{id:'txn_source_fixture',object:'balance_transaction',source:'ch_fixture',type:'charge',created:100,status:'available',currency:'usd',amount:11000,fee:500,net:10500}};
 const transfers=[];const requests=[];const extraTransactions=[];let available=100000;let networkFailure=false;let afterPost;
 const provider={async get(path){requests.push(['GET',path]);if(path.startsWith('/v1/payment_intents/'))return structuredClone(intent);if(path.startsWith('/v1/charges/'))return structuredClone(charge);
 if(path.startsWith('/v1/transfers?'))return {data:structuredClone(transfers),has_more:false};
 if(path==='/v1/account')return {object:'account',id:'acct_platform_fixture',settings:{payouts:{schedule:{interval:'manual'}}}};
 if(path.startsWith('/v1/balance_transactions?'))return {object:'list',data:[...transfers.map((t,i)=>({id:'txn_transfer_'+i,object:'balance_transaction',source:t.id,type:'transfer',created:101+i,status:'available',currency:t.currency,amount:-t.amount,fee:0,net:-t.amount})),...extraTransactions,structuredClone(charge.balance_transaction)],has_more:false};
 if(path==='/v1/balance')return {livemode:false,available:[{currency:'usd',amount:available}]};
 if(path.startsWith('/v2/core/accounts/')){const id=path.split('/')[4].split('?')[0];return {id,metadata:id==='acct_host'?{dvnt_host_id:'fixture-host'}:{dvnt_promoter_id:'00000000-0000-4000-8000-000000000002'},configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:'active'}}}}}}}
 throw Error('Unexpected read '+path)},async post(path,body,key){requests.push(['POST',path,body,key]);assert.equal(path,'/v1/transfers');const t={id:'tr_fixture_'+transfers.length,amount:Number(body.amount),currency:body.currency,destination:body.destination,source_transaction:body.source_transaction,transfer_group:body.transfer_group,metadata:{settlement_order_id:body['metadata[settlement_order_id]'],settlement_allocation_id:body['metadata[settlement_allocation_id]']},reversed:false,amount_reversed:0};transfers.push(t);available-=t.amount;if(afterPost)await afterPost(t);if(networkFailure){networkFailure=false;throw Error('fixture lost response')}return structuredClone(t)}};
 const candidate=()=>call('settlement_order',{p_order_id:p.order_id});const run=async(execute=true)=>processSettlementOrder(db,provider,await candidate(),{execute});
 return {pg,db,call,provider,candidate,run,p,charge,intent,transfers,requests,extraTransactions,setBalance:n=>available=n,loseResponse:()=>networkFailure=true,setAfterPost:f=>afterPost=f};
}

test('actual SQL + fake Stripe: promoter first, late onboarding holds host, replay and distinct bank status',async()=>{const f=await setup({onboard:false});try{
 const first=await f.run();assert.equal(first.transferred,0);assert.equal(f.transfers.length,0);
 let state=await f.candidate();assert.equal(state.allocations.find(a=>a.role==='promoter').state,'held');
 await f.pg.exec("update event_promoters set stripe_account_id='acct_promoter'");await f.run();assert.equal(f.transfers.length,2);assert.deepEqual(f.transfers.map(t=>t.destination),['acct_promoter','acct_host']);await f.run();assert.equal(f.transfers.length,2);
 assert.ok((await f.pg.query('select bank_payout_state from dvnt_settlement.deliveries')).rows.every(r=>r.bank_payout_state==='unverified'));
}finally{await f.pg.close()}});

test('lost transfer response reconciles unique exact transfer without sending twice',async()=>{const f=await setup();try{f.loseResponse();await f.run();assert.equal(f.transfers.length,1);assert.equal((await f.candidate()).allocations.find(a=>a.role==='promoter').state,'uncertain');await f.run();assert.equal(f.transfers.length,2);assert.equal((await f.candidate()).allocations.find(a=>a.role==='promoter').state,'transferred');await f.run();assert.equal(f.transfers.length,2);}finally{await f.pg.close()}});

test('DB failure after provider success quarantines then reconciles without duplicate',async()=>{const f=await setup();try{f.db.failRecord=true;await f.run();assert.equal(f.transfers.length,1);assert.equal((await f.candidate()).allocations.find(a=>a.role==='promoter').state,'uncertain');await f.run();assert.equal(f.transfers.length,2);}finally{await f.pg.close()}});

test('repeated overlapping workers dispatch each allocation at most once',async()=>{const f=await setup();try{await Promise.all([f.run(),f.run()]);assert.equal(f.transfers.length,2);}finally{await f.pg.close()}});

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
module.exports={setup,engine:exportsObject,funding:fundingExports};

test('executor sorts promoter first even when database returns organizer first',async()=>{const f=await setup();try{const original=f.db.rpc.bind(f.db);f.db.rpc=async(name,args)=>{const result=await original(name,args);if(name==='settlement_order'&&result.data?.allocations)result.data.allocations.sort((a,b)=>a.role==='organizer'?-1:1);return result};await f.run();assert.deepEqual(f.transfers.map(t=>t.destination),['acct_promoter','acct_host']);}finally{await f.pg.close()}});

test('unknown absent transfer never retries or releases host, even on later passes',async()=>{const f=await setup();try{let posts=0;f.provider.post=async()=>{posts++;throw Error('synthetic uncertain timeout')};await f.run();await f.run();await f.run();assert.equal(posts,1);const o=await f.candidate();assert.equal(o.allocations.find(a=>a.role==='promoter').state,'uncertain');assert.equal(o.allocations.find(a=>a.role==='organizer').state,'held');}finally{await f.pg.close()}});

test('source fees consuming retained amount and frozen recipient ownership mismatch prevent all sends',async()=>{for(const fault of ['fees','owner']){const f=await setup();try{if(fault==='fees'){f.charge.balance_transaction.fee=2000;f.charge.balance_transaction.net=9000}else{const get=f.provider.get;f.provider.get=async p=>{const v=await get(p);if(p.startsWith('/v2/'))v.metadata={dvnt_promoter_id:'wrong-promoter'};return v}}try{await f.run()}catch{}assert.equal(f.transfers.length,0);}finally{await f.pg.close()}}});

test('platform reserve remains after promoter transfer and blocks only insufficient host remainder',async()=>{const f=await setup();try{await f.pg.exec("update dvnt_settlement.currency_reserves set reserve_cents=1000");f.setBalance(10000);await f.run();assert.deepEqual(f.transfers.map(t=>t.destination),['acct_promoter']);assert.equal((await f.candidate()).allocations.find(a=>a.role==='organizer').state,'held');f.setBalance(9500);await f.run();assert.deepEqual(f.transfers.map(t=>t.destination),['acct_promoter','acct_host']);}finally{await f.pg.close()}});


test('platform automatic payout sweep or unreadable schedule blocks every new send',async()=>{for(const settings of [{payouts:{schedule:{interval:'weekly'}}},{}]){const f=await setup();try{const get=f.provider.get;f.provider.get=async(path,...args)=>path==='/v1/account'?{object:'account',id:'acct_platform_fixture',settings}:get(path,...args);const result=await f.run(true);assert.equal(f.transfers.length,0);assert.ok(result.held.some(x=>x.includes('platform_payout_policy_unverified')));}finally{await f.pg.close();}}});


test('legacy v1 recipient rejected by v2 stays held with no fallback, reservation or transfer',async()=>{const f=await setup();try{
 const reads=[],calls=[];const get=f.provider.get,rpc=f.db.rpc.bind(f.db);
 f.provider.get=async(path,...args)=>{reads.push(path);if(path.startsWith('/v2/core/accounts/'))throw Object.assign(new Error('v1_account_instead_of_v2_account'),{code:'v1_account_instead_of_v2_account'});return get(path,...args)};
 f.db.rpc=async(name,args)=>{calls.push(name);return rpc(name,args)};
 const result=await f.run();const allocations=(await f.candidate()).allocations;
 assert.equal(result.transferred,0);assert.equal(allocations.length,2);assert.ok(allocations.every(a=>a.state==='held'));
 const promoter=allocations.find(a=>a.role==='promoter'),host=allocations.find(a=>a.role==='organizer');
 assert.ok(result.held.includes(promoter.id+': verification_required'));assert.ok(result.held.includes(host.id+': promoter_pending'));
 assert.equal(reads.filter(p=>p.startsWith('/v2/core/accounts/')).length,1);
 assert.equal(reads.some(p=>p.startsWith('/v1/accounts')),false);assert.equal(calls.includes('settlement_reserve'),false);
 assert.equal(f.requests.filter(r=>r[0]==='POST').length,0);assert.equal(f.transfers.length,0);
}finally{await f.pg.close()}});
