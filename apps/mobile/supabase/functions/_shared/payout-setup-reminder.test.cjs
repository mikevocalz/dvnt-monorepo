const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const ts=require('typescript');
function load(file){const src=fs.readFileSync(file,'utf8');const mod={exports:{}};const built=ts.transpileModule(src,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}});new Function('exports','module','require',built.outputText)(mod.exports,mod,n=>load(path.resolve(path.dirname(file),n.endsWith('.ts')?n:n+'.ts')));return mod.exports;}
const {createPayoutReminderHandler,choosePayoutDestination,decidePayoutReminder}=load(path.join(__dirname,'payout-setup-reminder.ts'));
const {payoutReminderAllowed,payoutPromptCopy}=load(path.join(__dirname,'../../../../../packages/app/lib/payments/payout-reminder-policy.ts'));
const missing={payoutsEnabled:false,chargesEnabled:false,detailsSubmitted:false,currentlyDue:['external_account'],pastDue:[],pendingVerification:[],disabledReason:'requirements.past_due'};
const done={...missing,payoutsEnabled:true,chargesEnabled:true,detailsSubmitted:true,currentlyDue:[],disabledReason:null};
const review={...missing,detailsSubmitted:true,currentlyDue:[],pendingVerification:['individual.verification.document'],disabledReason:'requirements.pending_verification'};
function fixture({user='me',host=false,account=null,promoters=[],live=missing,lookupFail=false,failTable=null}={}){
  const seen=[],ids=[];
  const tables={
    events:host?[{id:7,host_id:'me'}]:[],
    organizer_accounts:account?[{host_id:'me',...account}]:[],
    event_promoters:promoters,
  };
  const db={from(table){
    const filters=[];const q={select(){return q},eq(k,v){filters.push(x=>x[k]===v);return q},neq(k,v){filters.push(x=>x[k]!==v);return q},order(){return q},limit(){return q},async maybeSingle(){const r=await execute();return {data:r.data?.[0]||null,error:r.error}},then(resolve,reject){return execute().then(resolve,reject)}}; 
    async function execute(){seen.push(table);if(failTable===table)return {data:null,error:{message:'test error'}};return{data:tables[table].filter(x=>filters.every(fn=>fn(x))),error:null};}return q;
  }};
  const h=createPayoutReminderHandler({db,authenticate:async()=>user,lookupStripe:async id=>{ids.push(id);if(lookupFail)throw Error('Stripe offline');return live},headers:()=>({})});
  return {seen,ids,call:async(method='POST')=>{const res=await h(new Request('https://fixture.invalid',{method}));return{status:res.status,json:res.status===204?null:await res.json()}}};
}
test('unauthenticated returns 401 before DB or Stripe',async()=>{const h=fixture({user:null,host:true});const r=await h.call();assert.equal(r.status,401);assert.equal(h.seen.length,0);assert.equal(h.ids.length,0)});
test('ordinary buyer receives no payout reminder',async()=>{const r=await fixture().call();assert.deepEqual(r.json,{ok:true,eligible:false,needsSetup:false})});
test('eligible event host without a connected account is reminded',async()=>{const r=await fixture({host:true}).call();assert.equal(r.json.needsSetup,true);assert.equal(r.json.role,'organizer');assert.equal(r.json.route,'/feed/events/organizer-setup');assert.equal(r.json.state,'setup')});
test('existing organizer lacking bank details is reminded using live Stripe',async()=>{const h=fixture({account:{stripe_account_id:'acct_123456789abcdef'},live:missing});const r=await h.call();assert.equal(r.json.state,'action_required');assert.deepEqual(h.ids,['acct_123456789abcdef'])});
test('eligible promoter receives their own event route',async()=>{const h=fixture({promoters:[{user_id:'me',event_id:55,status:'active',stripe_account_id:'acct_123456789abcdef'}]});const r=await h.call();assert.equal(r.json.role,'promoter');assert.equal(r.json.route,'/feed/events/55/promoter')});
test('removed promoter is not shown a payout reminder',async()=>{const r=await fixture({promoters:[{user_id:'me',event_id:55,status:'removed'}]}).call();assert.equal(r.json.eligible,false)});
test('stale unlinked promoter row does not override linked account',async()=>{const h=fixture({promoters:[{user_id:'me',event_id:55,status:'active',stripe_account_id:null},{user_id:'me',event_id:56,status:'active',stripe_account_id:'acct_123456789abcdef'}]});const r=await h.call();assert.equal(r.json.route,'/feed/events/56/promoter');assert.equal(h.ids.length,1)});
test('finished Stripe onboarding stops all reminders',async()=>{const r=await fixture({host:true,account:{stripe_account_id:'acct_123456789abcdef'},live:done}).call();assert.equal(r.json.needsSetup,false)});
test('Stripe reviewing gets status-only copy',async()=>{const r=await fixture({host:true,account:{stripe_account_id:'acct_123456789abcdef'},live:review}).call();assert.equal(r.json.state,'reviewing');assert.match(payoutPromptCopy(r.json.state).action,/status/)});
test('Stripe timeout fails closed, not a false warning',async()=>{const r=await fixture({host:true,account:{stripe_account_id:'acct_123456789abcdef'},lookupFail:true}).call();assert.equal(r.status,503)});
test('database error stops reminders',async()=>{const r=await fixture({host:true,failTable:'event_promoters'}).call();assert.equal(r.status,503)});
test('never leak arbitrary Stripe account data to public clients',async()=>{const r=await fixture({host:true,account:{stripe_account_id:'acct_123456789abcdef'},live:missing}).call();assert.ok(!JSON.stringify(r.json).includes('acct_'));assert.ok(!JSON.stringify(r.json).includes('external_account'))});
test('separate users cannot see another payout record',async()=>{const h=fixture({user:'other',host:true,account:{stripe_account_id:'acct_123456789abcdef'}});const r=await h.call();assert.equal(r.json.eligible,false);assert.equal(h.ids.length,0)});
test('methods and OPTIONS are enforced',async()=>{const h=fixture();assert.equal((await h.call('GET')).status,405);assert.equal((await h.call('OPTIONS')).status,204)});
test('no modal over checkout, onboarding, account repair or immersive calls',()=>{
  for(const p of ['/feed/checkout/review','/feed/events/organizer-setup','/feed/events/44/promoter','/feed/onboarding/photo','/feed/call','/feed/create','/auth/sign-in'])assert.equal(payoutReminderAllowed(p),false,p);
  assert.equal(payoutReminderAllowed('/feed'),true);assert.equal(payoutReminderAllowed('/feed/events/8'),true);
});
