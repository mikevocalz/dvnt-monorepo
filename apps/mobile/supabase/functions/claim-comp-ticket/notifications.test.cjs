const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
function harness({ actor='auth-claimant', alreadyClaimed=false, claimError=false, profileMissing=false, lookupError=false, insertError=false, insertThrows=false, issuerMissing=false, receiptError=false }={}) {
 let handler; const notifications=[], warnings=[], lookups=[], receipts=[];
 const db={
  rpc:async(name)=>{assert.equal(name,'claim_comp_ticket_with_receipt');return claimError?{error:{code:'rpc_error'}}:{data:{ok:true,ticket_id:'ticket-1',event_id:80,already_claimed:alreadyClaimed,receipt_ids:alreadyClaimed?[]:['receipt-claim']}};},
  from(table){let authId;return {
   select(){return this;},eq(key,value){lookups.push({table,key,value});if(key==='auth_id')authId=value;return this;},
   maybeSingle:async()=>table==='ticket_claim_links'?{data:issuerMissing?null:{issued_by:'original-issuer'}}:{data:profileMissing?null:{id:authId==='original-issuer'?17:42},error:lookupError?{code:'lookup_error'}:null},
   insert:async payload=>{if(insertThrows)throw Error('private secret');notifications.push(payload);return {error:insertError?{code:'insert_error',message:'private secret'}:null};},
  };},
 };
 const source=ts.transpileModule(fs.readFileSync(`${__dirname}/index.ts`,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 const req=name=>name.includes('ticket-receipt-delivery')?{deliverTicketReceipts:async(client,ids)=>{assert.equal(client,db);receipts.push([...ids]);if(receiptError)throw Error('mail unavailable');}}:name.includes('supabase-js')?{createClient:()=>db}:name.includes('verify-session')?{verifySession:async()=>actor,corsHeaders:()=>({}),optionsResponse:()=>new Response(null,{status:204})}:name.includes('rate-limit')?{checkRateLimit:()=>({allowed:true})}:name.includes('verified-admission')?{resolveVerifiedAdmission:async()=>({state:'allowed'}),admissionRefusal:()=>({})}:name.includes('comp-claim-links')?{isClaimToken:()=>true,claimRefusal:()=>({status:401,code:'unauthenticated',message:'Sign in'})}:(()=>{throw Error(name)})();
 new Function('require','exports','Deno','console',source)(req,{}, {env:{get:()=>''},serve:fn=>{handler=fn;}},{warn:(...args)=>warnings.push(args),error(){}});
 return {notifications,warnings,lookups,receipts,async invoke(){const r=await handler(new Request('https://offline.test',{method:'POST',body:JSON.stringify({token:'x'.repeat(43)})}));return {status:r.status,body:await r.json()};}};
}
test('new claim notifies only canonical claimant profile with exact pass route, no bearer secret or invented actor',async()=>{
 const h=harness();assert.equal((await h.invoke()).status,200);
 assert.deepEqual(h.lookups,[{table:'users',key:'auth_id',value:'auth-claimant'},{table:'ticket_claim_links',key:'ticket_id',value:'ticket-1'},{table:'ticket_claim_links',key:'claimed_by',value:'auth-claimant'},{table:'users',key:'auth_id',value:'original-issuer'}]);
 assert.deepEqual(h.notifications,[{recipient_id:42,actor_id:17,type:'ticket_comped',entity_type:'event',entity_id:'80',entity_payload:{ticket_id:'ticket-1'}}]);
});
test('idempotent claim replay never emits a second notification',async()=>{const h=harness({alreadyClaimed:true});assert.equal((await h.invoke()).status,200);assert.equal(h.notifications.length,0);assert.equal(h.lookups.length,0);});
for(const opt of [{profileMissing:true},{lookupError:true},{insertError:true},{insertThrows:true}])test(`committed claim stays successful when feed unavailable ${JSON.stringify(opt)}`,async()=>{const h=harness(opt);assert.equal((await h.invoke()).status,200);assert.equal(h.warnings.length,1);assert.ok(!JSON.stringify(h.warnings).includes('private secret'));if(opt.profileMissing||opt.lookupError)assert.equal(h.notifications.length,0);});
for(const opt of [{actor:null},{claimError:true}])test(`failed or unauthenticated claim emits no notification ${JSON.stringify(opt)}`,async()=>{const h=harness(opt);assert.notEqual((await h.invoke()).status,200);assert.equal(h.notifications.length,0);});

test('missing issuer is not attributed to claimant or an assumed event host',async()=>{const h=harness({issuerMissing:true});assert.equal((await h.invoke()).status,200);assert.equal(h.notifications[0].actor_id,null);});

for (const receiptError of [false,true]) test(`claim processes its atomic receipt without undoing claim (${receiptError})`,async()=>{
 const h=harness({receiptError});assert.equal((await h.invoke()).status,200);
 assert.deepEqual(h.receipts,[['receipt-claim']]);assert.equal(h.notifications.length,1);
});
test('claim replay has no new receipt IDs',async()=>{const h=harness({alreadyClaimed:true});assert.equal((await h.invoke()).status,200);assert.deepEqual(h.receipts,[[]]);});
for(const opt of [{actor:null},{claimError:true}])test(`refused claim never processes receipts ${JSON.stringify(opt)}`,async()=>{const h=harness(opt);assert.notEqual((await h.invoke()).status,200);assert.deepEqual(h.receipts,[]);});
