const {test}=require('node:test');const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),path=require('node:path'),ts=require('typescript');
const root=path.join(__dirname,'../apps/mobile/supabase/functions/_shared');
function load(file){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,Date,console:{error(){}},require:p=>load(path.resolve(path.dirname(file),p))});return exports;}
const {resolveAdultVerificationState:resolveSpicyEligibility}=load(path.join(root,'verification-state.ts'));
function db(record,grant,error=null){let calls=0;const q={select(){return q},eq(){return q},maybeSingle:async()=>({data:record,error})};return {from:()=>q,rpc:async()=>{calls++;return grant},calls:()=>calls};}
for(const [label,record,grant,expected] of [
 ['explicit legacy grant',null,{data:true},'approved'],
 ['no grant',null,{data:false},'not_started'],
 ['grant lookup error',null,{data:true,error:{code:'XX000'}},'not_started'],
 ['untrusted truthy grant',null,{data:'true'},'not_started'],
 ['wrong account',{user_id:'other',status:'passed',date_of_birth:'1990-01-01'},{data:true},'not_started'],
 ['underage',{user_id:'owner',status:'failed',date_of_birth:'2015-01-01',failure_code:'underage'},{data:true},'rejected'],
 ['duplicate identity',{user_id:'owner',status:'failed',failure_code:'duplicate_identity'},{data:true},'rejected'],
 ['document adult',{user_id:'owner',status:'passed',date_of_birth:'1990-01-01'},{data:false},'approved'],
]) test(label,async()=>{const d=db(record,grant);const r=await resolveSpicyEligibility(d,'owner');assert.equal(r.state,expected);if(label==='explicit legacy grant'){assert.equal(r.reason,'legacy_membership');assert.equal(r.providerRef,null)}if(['wrong account','underage','duplicate identity','document adult'].includes(label))assert.equal(d.calls(),0)});
test('identity read error cannot be overridden by a legacy grant',async()=>{const d=db(null,{data:true},{code:'XX000',message:'unavailable'});assert.notEqual((await resolveSpicyEligibility(d,'owner')).state,'approved');assert.equal(d.calls(),0)});
test('anonymous cannot acquire a grant',async()=>{const d=db(null,{data:true});assert.notEqual((await resolveSpicyEligibility(d,null)).state,'approved');assert.equal(d.calls(),0)});
