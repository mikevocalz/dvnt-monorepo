/** Real worker HTTP adapter, combined SQL and canonical issuers. Provider
 * responses are synthetic; this does not claim Stripe sandbox execution. */
const {test}=require('node:test');const assert=require('node:assert/strict');
const {setup,worker}=require('./fixtures/settlement/fulfillment.cjs');
const {legacyProvider,SettlementProviderError}=require('./fixtures/settlement/recipient.cjs');
const env={SETTLEMENT_WORKER_ENABLED:'true',SETTLEMENT_TRANSFERS_ENABLED:'true'};
function watch(f){const calls=[];const rpc=f.db.rpc.bind(f.db);f.db.rpc=async(name,args)=>{calls.push([name,args]);return rpc(name,args)};return calls;}
async function runWorker(f){const response=await worker(f.db,f.provider,env)();assert.equal(response.status,200);const text=await response.text();assert.doesNotMatch(text,/synthetic private provider details|fixture_provider|fixture_service/);return JSON.parse(text);}
for(const rail of ['create-payment-intent','ticket-checkout','guest-checkout','cart-checkout'])test(rail+': exact legacy proof traverses real HTTP adapter and canonical fulfillment, promoter first and idempotent',async()=>{
 const f=await setup({rail,cartAddon:true});try{
  const reads=legacyProvider(f.provider);const calls=watch(f);
  assert.equal((await f.issue()).ok,true);const response=await runWorker(f);
  assert.ok(response.results.some(r=>r.transferred===2));assert.deepEqual(f.transfers.map(t=>[t.destination,t.amount]),[['acct_promoter',1000],['acct_host',8500]]);
  const accountReads=reads.filter(([path])=>path.startsWith('/v1/accounts/'));assert.deepEqual(accountReads,[['/v1/accounts/acct_promoter',undefined],['/v1/accounts/acct_host',undefined]]);
  assert.deepEqual(reads.filter(([path,account])=>path==='/v1/balance'&&account),[['/v1/balance','acct_promoter'],['/v1/balance','acct_host']]);
  assert.equal(calls.filter(([name])=>name==='settlement_reserve').length,2);
  assert.ok((await f.pg.query('SELECT bank_payout_state FROM dvnt_settlement.deliveries')).rows.every(row=>row.bank_payout_state==='unverified'));
  await f.run();assert.equal(f.transfers.length,2);
 }finally{await f.pg.close()}
});
for(const [name,options,reason,legacyReads] of [
 ['generic provider rejection',{error:new SettlementProviderError(400,'invalid_request_error')},'verification_required',0],
 ['authentication',{error:new SettlementProviderError(401,'v1_account_instead_of_v2_account')},'verification_required',0],
 ['authorization',{error:new SettlementProviderError(403,'v1_account_instead_of_v2_account')},'verification_required',0],
 ['network',{error:Error('synthetic private provider details')},'verification_required',0],
 ['malformed v1',{mutate:a=>a.object='list'},'recipient_restricted',1],
 ['other destination',{mutate:a=>a.id='acct_other'},'recipient_restricted',1],
 ['unbound actual-list shape',{mutate:a=>{a.metadata={dvnt_test_fixture:'synthetic'};delete a.requirements;delete a.details_submitted;delete a.external_accounts;}},'recipient_restricted',1],
 ['restricted transfer capability',{mutate:a=>a.capabilities.transfers='inactive'},'recipient_restricted',1],
 ['incomplete requirements',{mutate:a=>delete a.requirements},'recipient_restricted',1],
 ['wrong owner',{mutate:a=>a.metadata.dvnt_promoter_id='another-promoter'},'recipient_restricted',1],
 ['wrong currency',{mutate:a=>a.default_currency='eur'},'recipient_restricted',1],
 ['missing bank',{mutate:a=>delete a.external_accounts},'recipient_restricted',1],
 ['bank failure',{mutate:a=>a.external_accounts.data[0].status='errored'},'recipient_restricted',1],
 ['live mode',{mode:true},'recipient_restricted',1],
 ['missing mode',{mode:null},'recipient_restricted',1],
])test('real worker '+name+' preserves held allocations and attention without reservation or transfer',async()=>{
 const f=await setup();try{
  const reads=legacyProvider(f.provider,options);const calls=watch(f);assert.equal((await f.issue()).ok,true);await runWorker(f);
  assert.equal(f.transfers.length,0);assert.equal(calls.some(([name])=>name==='settlement_reserve'),false);
  const order=await f.candidate();assert.equal(order.allocations.length,2);assert.ok(order.allocations.every(a=>a.state==='held'));
  const errors=calls.filter(([name])=>name==='settlement_processing_error').map(([,args])=>args.p_code);assert.ok(errors.includes(reason));assert.ok(errors.includes('promoter_pending'));
  const v2Reads=reads.filter(([path])=>path.startsWith('/v2/core/accounts/'));
  assert.ok(v2Reads.length>0);
  assert.equal(reads.filter(([path])=>path.startsWith('/v1/accounts/')).length,legacyReads?v2Reads.length:0);
  assert.ok((await f.pg.query('SELECT last_error FROM dvnt_settlement.deliveries')).rows.every(row=>row.last_error));
 }finally{await f.pg.close()}
});
test('legacy readiness never bypasses canonical fulfillment or source-accounted funding',async()=>{
 for(const blocker of ['fulfillment','risk reserve','policy mode']){
  const f=await setup({fundingMode:blocker==='policy mode'});try{
   const reads=legacyProvider(f.provider);const calls=watch(f);
   if(blocker!=='fulfillment')assert.equal((await f.issue()).ok,true);
   if(blocker==='risk reserve')await f.pg.exec('UPDATE dvnt_settlement.currency_reserves SET reserve_cents=1000000');
   await runWorker(f);assert.equal(f.transfers.length,0);
   if(blocker==='fulfillment'){assert.equal(reads.some(([path])=>path.startsWith('/v2/core/accounts/')),false);assert.equal(calls.some(([name])=>name==='settlement_reserve'),false);}
   if(blocker==='policy mode')assert.equal(calls.some(([name])=>name==='settlement_reserve'),false);
  }finally{await f.pg.close()}
 }
});
test('SQL rejects a changed candidate and a new current link cannot substitute frozen actor proof',async()=>{
 const f=await setup();try{
  legacyProvider(f.provider);const get=f.provider.get.bind(f.provider);let changed=false;
  f.provider.get=async(path,account)=>{const response=await get(path,account);if(path==='/v1/accounts/acct_other')response.metadata={dvnt_promoter_id:'other-promoter'};if(path==='/v1/balance'&&account==='acct_promoter'&&!changed){changed=true;await f.pg.exec("UPDATE event_promoters SET stripe_account_id='acct_other'")}return response;};
  assert.equal((await f.issue()).ok,true);await runWorker(f);assert.equal(f.transfers.length,0);
  const order=await f.candidate();assert.ok(order.allocations.every(a=>a.state==='held'));assert.equal(order.allocations.find(a=>a.role==='promoter').candidate_destination,'acct_other');
 }finally{await f.pg.close()}
});
