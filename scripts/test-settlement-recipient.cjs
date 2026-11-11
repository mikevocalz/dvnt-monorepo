const {test}=require('node:test');const assert=require('node:assert/strict');
const {readRecipientProof,verifyLegacyRecipient,verifyRecipientFundingMode,LegacyRecipientError,SettlementProviderError,legacyAccount}=require('./fixtures/settlement/recipient.cjs');
const destination='acct_promoter',allocation={role:'promoter',recipient_id:'00000000-0000-4000-8000-000000000002',recipient_user_id:null};
function fixture({failure=new SettlementProviderError(400,'v1_account_instead_of_v2_account'),account=legacyAccount(),balance={object:'balance',livemode:false,available:[],pending:[]}}={}) {
 const reads=[];return {reads,provider:{get:async(path,context)=>{reads.push([path,context]);if(path.startsWith('/v2/')){if(failure)throw failure;return account;}if(path==='/v1/accounts/'+destination)return account;if(path==='/v1/balance'&&context===destination)return balance;throw Error('unexpected read');}}};
}
const read=f=>readRecipientProof(f.provider,destination,allocation,'usd');
const limitation=(error,reason)=>error instanceof LegacyRecipientError&&error.limitation===reason;
test('typed exact v2 HTTP 400 alone selects one exact same-account GET and connected mode proof',async()=>{
 const f=fixture();const proof=await read(f);assert.equal(proof.kind,'legacy_v1_test');assert.equal(proof.livemode,false);assert.equal(proof.destination,destination);
 assert.equal(proof.configuration,undefined);assert.deepEqual(f.reads,[[`/v2/core/accounts/${destination}?include[0]=configuration.recipient`,undefined],[`/v1/accounts/${destination}`,undefined],['/v1/balance',destination]]);
 verifyRecipientFundingMode(proof,false);for(const mode of [true,undefined,null,0,'false'])assert.throws(()=>verifyRecipientFundingMode(proof,mode),e=>limitation(e,'mode'));
});
for(const [name,failure] of [
 ['network',Error('network failed')],['timeout',Object.assign(Error('timeout'),{code:'v1_account_instead_of_v2_account'})],
 ['generic invalid request',new SettlementProviderError(400,'invalid_request_error')],['message only',Error('v1_account_instead_of_v2_account')],
 ...[200,401,403,404,409,429,500,503].map(status=>['HTTP '+status,new SettlementProviderError(status,'v1_account_instead_of_v2_account')]),
 ['lookalike object',{status:400,code:'v1_account_instead_of_v2_account'}],['other code',new SettlementProviderError(400,'account_invalid')],
])test(name+' never triggers legacy reads',async()=>{const f=fixture({failure});await assert.rejects(read(f));assert.equal(f.reads.length,1)});
for(const [name,account] of [['active',{id:destination,metadata:{dvnt_promoter_id:allocation.recipient_id},configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:'active'}}}}}}],['missing',{id:destination}],['restricted',{id:destination,configuration:{recipient:{capabilities:{stripe_balance:{stripe_transfers:{status:'restricted'}}}}}}],['malformed',null],['wrong account',{id:'acct_other'}],['legacy-shaped success',legacyAccount()]])test('v2 '+name+' keeps original gates without fallback',async()=>{
 const f=fixture({failure:null,account});if(name==='active'){assert.equal((await read(f)).kind,'v2');verifyRecipientFundingMode({kind:'v2'},true);}else await assert.rejects(read(f));assert.equal(f.reads.length,1);
});
const cases=[
 ['wrong account','identity',a=>a.id='acct_other'],['list response','identity',a=>a.object='list'],['deleted','identity',a=>a.deleted=true],
 ['missing owner','ownership',a=>a.metadata={}],['wrong owner','ownership',a=>a.metadata.dvnt_promoter_id='another-promoter'],['current user without frozen identity','ownership',a=>a.metadata.dvnt_user_id='new-user'],
 ['inactive transfers','capability',a=>a.capabilities.transfers='inactive'],['pending transfers','capability',a=>a.capabilities.transfers='pending'],['missing transfers','capability',a=>delete a.capabilities],['charges only','capability',a=>{delete a.capabilities;a.charges_enabled=true}],
 ['wrong currency','currency',a=>a.default_currency='eur'],['wrong country','currency',a=>a.country='CA'],
 ['missing requirements','requirements',a=>delete a.requirements],['null requirements','requirements',a=>a.requirements=null],['absent disabled reason','requirements',a=>delete a.requirements.disabled_reason],['disabled reason','requirements',a=>a.requirements.disabled_reason='requirements.past_due'],
 ...['currently_due','past_due','pending_verification','errors'].flatMap(key=>[[key+' missing','requirements',a=>delete a.requirements[key]],[key+' pending','requirements',a=>a.requirements[key]=['synthetic']] ]),
 ['payouts disabled','bank',a=>a.payouts_enabled=false],['payouts absent','bank',a=>delete a.payouts_enabled],['details missing','bank',a=>delete a.details_submitted],['not controller','bank',a=>a.controller.is_controller=false],
 ['no bank list','bank',a=>delete a.external_accounts],['truncated bank list','bank',a=>a.external_accounts.has_more=true],['wrong list scope','bank',a=>a.external_accounts.url='/v1/accounts/acct_other/external_accounts'],['no bank','bank',a=>a.external_accounts.data=[]],
 ['standard payout unavailable','bank',a=>a.external_accounts.data[0].available_payout_methods=['instant']],['payout method unknown','bank',a=>delete a.external_accounts.data[0].available_payout_methods],
 ['non-bank default','bank',a=>a.external_accounts.data[0].object='card'],['foreign bank','bank',a=>a.external_accounts.data[0].account='acct_other'],['bank currency','bank',a=>a.external_accounts.data[0].currency='eur'],['bank country','bank',a=>a.external_accounts.data[0].country='CA'],['not default','bank',a=>a.external_accounts.data[0].default_for_currency=false],['duplicate default','bank',a=>a.external_accounts.data.push({...a.external_accounts.data[0],id:'ba_duplicate'})],
 ...['errored','verification_failed','tokenized_account_number_deactivated','validated','verified','pending',null,undefined].map(status=>['bank '+status,'bank',a=>a.external_accounts.data[0].status=status]),
];
for(const [name,reason,mutate]of cases)test('legacy '+name+' fails before mode read',async()=>{const account=legacyAccount();mutate(account);const f=fixture({account});await assert.rejects(read(f),e=>limitation(e,reason));assert.equal(f.reads.length,2)});
for(const balance of [{object:'balance',livemode:false}, {object:'balance',livemode:true},{object:'balance'},null,{object:'account',livemode:false},{object:'balance',livemode:'false'}])test('legacy balance mode fails closed '+JSON.stringify(balance),async()=>{await assert.rejects(read(fixture({balance})),e=>limitation(e,'mode'))});
test('frozen host and promoter actor binding reject conflicting metadata, absent actor, or current roster substitution',()=>{
 for(const allocation of [{role:'organizer',recipient_id:'frozen-host'},{role:'promoter',recipient_id:'promoter-row',recipient_user_id:'frozen-host'}]){
  const account=legacyAccount(destination,{dvnt_user_id:'frozen-host'});verifyLegacyRecipient(account,destination,allocation,'usd');
  account.metadata.dvnt_host_id='current-roster-owner';assert.throws(()=>verifyLegacyRecipient(account,destination,allocation,'usd'),e=>limitation(e,'ownership'));
  account.metadata={dvnt_promoter_id:allocation.recipient_id};assert.throws(()=>verifyLegacyRecipient(account,destination,allocation,'usd'),e=>limitation(e,'ownership'));
 }
 assert.throws(()=>verifyLegacyRecipient(legacyAccount(),destination,allocation,'eur'),e=>limitation(e,'currency'));
});
test('sanitized actual LIST shape is unbound, not a successful exact retrieve or inferred ready proof',async()=>{
 const account={id:destination,object:'account',capabilities:{transfers:'active'},payouts_enabled:true,default_currency:'usd',country:'US',controller:{is_controller:true},metadata:{dvnt_test_fixture:'synthetic'}};
 assert.equal('requirements'in account,false);assert.equal('livemode'in account,false);
 const f=fixture({account});await assert.rejects(read(f),e=>limitation(e,'ownership'));assert.equal(f.reads.length,2);
});
test('provider error only retains reviewed code and bounded status, never arbitrary sensitive payload',()=>{
 for(const code of ['private account message','sk_fixture_private',{message:'private'},null]){const error=new SettlementProviderError(400,code);assert.equal(error.code,null);assert.doesNotMatch(String(error)+JSON.stringify(error),/private|sk_fixture/);}
 assert.equal(new SettlementProviderError(NaN,'anything').status,0);
});
test('failed exact v1 read or connected balance read is never retried',async()=>{
 for(const at of [2,3]){const f=fixture();const get=f.provider.get;f.provider.get=async(...args)=>{if(f.reads.length===at-1){f.reads.push(args);throw Error('read failed')}return get(...args)};await assert.rejects(read(f),/read failed/);assert.equal(f.reads.length,at)}
});

// Run the unchanged HTTP request implementation from the real worker entrypoint.
// Mock only its database transport and order coordinator, not the adapter.
async function adapterFixture({status=400,code='v1_account_instead_of_v2_account',body,network=false,invalidJson=false}={}) {
 const {readFileSync}=require('node:fs'),{resolve}=require('node:path'),vm=require('node:vm'),ts=require('typescript');
 const source=readFileSync(resolve(__dirname,'../apps/mobile/supabase/functions/settlements-process/index.ts'),'utf8').replace(/^import[\s\S]*?from [^;]+;\n/gm,'');
 const requests=[];let handler,phase=0,claimed=false,captured;
 const db={rpc:async name=>({error:null,data:name==='settlement_worker_next_phase'?phase++%5:name==='settlement_candidates'?!claimed?(claimed=true,[{}]):[]:name.endsWith('_candidates')?[]:{observed_at:'2026-01-01T00:00:00Z'}})};
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:{},Response,Request,URLSearchParams,AbortSignal,performance,SettlementProviderError,
  withSentry:(_n,fn)=>fn,withHeartbeat:(_n,fn)=>fn(),createClient:()=>db,
  settlementRpc:async(db,name,args)=>(await db.rpc(name,args)).data,settlementFailureCode:()=> 'verification_required',verifyPlatformPayoutPolicy:()=>{},
  reconcileSettlementBankEvents:async()=>[],processSettlementOrder:async(_db,provider)=>{try{return {state:'processed',proof:await readRecipientProof(provider,destination,allocation,'usd')}}catch(error){captured=error;throw error}},
  Deno:{env:{get:key=>({SETTLEMENT_WORKER_SECRET:'worker_fixture',SETTLEMENT_WORKER_ENABLED:'true',SETTLEMENT_TRANSFERS_ENABLED:'true',SETTLEMENT_RUN_BUDGET_MS:'120000',STRIPE_SECRET_KEY:'private_key_fixture',SUPABASE_URL:'https://fixture.invalid',SUPABASE_SERVICE_ROLE_KEY:'private_service_fixture'})[key]},serve:fn=>handler=fn},
  fetch:async(url,options)=>{requests.push([url,options]);if(url.includes('/v2/')){if(network)throw Error('private_network_payload');if(invalidJson)return new Response('private_html_payload',{status});return Response.json(body??{error:{code,message:'private_account_payload',request_log_url:'https://private.invalid'}},{status})}if(url.endsWith('/v1/accounts/'+destination))return Response.json(legacyAccount());if(url.endsWith('/v1/balance'))return Response.json({object:'balance',livemode:false,available:[],pending:[]});return Response.json({object:'account',id:'acct_platform_fixture'});},
 });
 const response=await handler(new Request('https://fixture.invalid',{method:'POST',headers:{Authorization:'Bearer worker_fixture'}}));
 const text=await response.text();assert.doesNotMatch(text,/private_|request_log|v1_account_instead/);return {requests,response:JSON.parse(text),captured};
}
test('actual HTTP adapter preserves only exact reviewed error code and connected-account header',async()=>{
 const f=await adapterFixture();assert.ok(f.response.results.some(r=>r.proof?.kind==='legacy_v1_test'));
 const connected=f.requests.find(([url])=>url.endsWith('/v1/balance'));assert.equal(connected[1].headers['Stripe-Account'],destination);
 assert.ok(f.requests.every(([,options])=>options.method==='GET'));assert.equal(f.requests.filter(([url])=>url.endsWith('/v1/accounts/'+destination)).length,1);
});
for(const [name,options] of [['401',{status:401}],['403',{status:403}],['200 error',{status:200}],['generic',{code:'invalid_request_error'}],['raw arbitrary code',{code:'private_raw_code'}],['malformed JSON',{invalidJson:true}],['network',{network:true}],['no typed error envelope',{body:{code:'v1_account_instead_of_v2_account'}}]])test('actual HTTP adapter '+name+' never falls back or leaks provider body',async()=>{
 const f=await adapterFixture(options);assert.equal(f.requests.some(([url])=>url.includes('/v1/accounts/')),false);
 assert.ok(f.captured);if(f.captured instanceof SettlementProviderError)assert.doesNotMatch(String(f.captured)+JSON.stringify(f.captured),/private_|request_log/);
});
