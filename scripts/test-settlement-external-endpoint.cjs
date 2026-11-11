const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
function fixture({actor='fixture-operator',allowed=true,enabled=true,failure=false}={}){
 let handler;const calls=[];
 const source=fs.readFileSync(path.join(__dirname,'../apps/mobile/supabase/functions/record-external-promoter-payment/index.ts'),'utf8').replace(/^import[\s\S]*?from [^;]+;\n/gm,'');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports:{},Response,Request,verifySession:async()=>actor,corsHeaders:()=>({}),optionsResponse:()=>new Response(null,{status:204}),
  createClient:()=>({rpc:async(name,args)=>{calls.push({name,args});return name==='settlement_external_operator_allowed'?{data:allowed,error:null}:failure?{data:null,error:{message:'PRIVATE RECEIPT DETAILS'}}:{data:{id:'fixture-record',recorded:true,status:'paid_externally'},error:null};}}),
  Deno:{env:{get:k=>k==='EXTERNAL_PROMOTER_RECORDING_ENABLED'?(enabled?'true':undefined):'fixture'},serve:fn=>handler=fn},
 });return{calls,call:(body,method='POST')=>handler(new Request('https://fixture.invalid',{method,...(method==='POST'?{body:JSON.stringify(body)}:{})}))};
}
const body=()=>({request_key:'00000000-0000-4000-8000-000000000031',event_id:1,promoter_id:'00000000-0000-4000-8000-000000000002',recipient_binding_id:'00000000-0000-4000-8000-000000000003',ledger_entry_ids:['00000000-0000-4000-8000-000000000021'],amount_cents:1000,currency:'usd',provider:'fixture_provider',transaction_reference:'fixture-transaction',receipt_sha256:'a'.repeat(64),receipt_reference:'fixture-vault/receipt/version-1',evidence_status:'completed',paid_at:'2026-01-01T00:00:00Z',receipt_beneficiary_reference:'fixture-beneficiary',attestation:{independently_checked_completed_final:true,receipt_retained:true,recipient_and_details_match:true}});
test('default-off and unauthenticated/nonoperator callers cannot reach financial recording',async()=>{
 for(const [options,status] of [[{enabled:false},503],[{actor:null},401],[{allowed:false},403]]){const f=fixture(options);assert.equal((await f.call(body())).status,status);assert.ok(!f.calls.some(c=>c.name==='settlement_record_external_promoter_payment'));}
});
test('endpoint exclusively derives actor from verified session, rejects injection/oversize, returns no private errors',async()=>{
 const f=fixture();assert.equal((await f.call({...body(),actor:'fixture-other'})).status,400);
 assert.equal((await f.call({...body(),p_actor:'fixture-other'})).status,400);
 assert.equal((await f.call({...body(),receipt_reference:'x'.repeat(70000)})).status,413);
 const response=await f.call(body());assert.equal(response.status,200);assert.equal(response.headers.get('Cache-Control'),'no-store');
 assert.equal(f.calls.at(-1).args.p_actor,'fixture-operator');assert.equal(f.calls.at(-1).name,'settlement_record_external_promoter_payment');
 const rejected=await fixture({failure:true}).call(body());assert.equal(rejected.status,409);assert.doesNotMatch(await rejected.text(),/PRIVATE/);
});
test('method, missing scope, numeric strings and malformed IDs fail before recording',async()=>{
 const f=fixture();assert.equal((await f.call(null,'OPTIONS')).status,204);assert.equal((await f.call(null,'GET')).status,405);
 for(const input of [null,[],{...body(),event_id:'1'},{...body(),amount_cents:1.5},{...body(),promoter_id:'bad'},{...body(),ledger_entry_ids:[]}])assert.equal((await f.call(input)).status,400);
 assert.ok(!f.calls.some(c=>c.name==='settlement_record_external_promoter_payment'));
});
