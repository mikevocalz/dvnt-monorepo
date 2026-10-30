// Actual notification API and access helper, with a stateful PostgREST-shaped fixture.
// No remote requests; SQL authorization is covered separately by the real PG suite.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const ts=require('typescript');
function fixture(options={}) {
 let userId=options.signedOut?null:1, epoch=0;
 let profile=options.profile===undefined?{id:1,authId:'auth-A'}:options.profile;
 const calls=[],mintSubjects=[];
 const rows=[{id:10,recipient_id:1,type:'ticket_comped',entity_type:null,entity_id:null,actor_id:null,read_at:null,created_at:'2026-10-30T00:00:00Z'},
   {id:20,recipient_id:2,type:'ticket_comped',entity_type:null,entity_id:null,actor_id:null,read_at:null,created_at:'2026-10-30T00:00:00Z'}];
 const switchAccount=()=>{userId=2;profile={id:2,authId:'auth-B'};epoch++;};
 const db={from(table){const call={table,filters:[],headers:{},operation:'select',patch:null};calls.push(call);
  const q={select(){return q;},update(p){call.operation='update';call.patch=p;return q;},eq(k,v){call.filters.push([k,v]);return q;},is(k,v){call.filters.push([k,v]);return q;},order(){return q;},limit(){return q;},setHeader(k,v){call.headers[k]=v;return q;},
   then(resolve,reject){const hit=rows.filter(r=>call.filters.every(([k,v])=>r[k]===v));if(call.operation==='update')for(const r of hit)Object.assign(r,call.patch);
    if(options.switchAfterResult)switchAccount();return Promise.resolve({data:hit,error:options.queryError?{message:'fixture query failed'}:null,count:options.missingCount?null:hit.length}).then(resolve,reject);}};return q;}};
 const deps={
  '../supabase/client':{supabase:db,getBridgeRequestEpoch:()=>String(epoch)},
  '../auth/identity':{getCurrentUserIdSync:()=>userId,getCurrentUserRow:async()=>{if(options.switchDuringProfile)switchAccount();return profile;},requireBetterAuthToken:async()=>''},
  '../auth/session-lifecycle':{getSessionLifecycle:()=>({epoch,ready:!!userId})},
  '../auth/supabase-jwt':{ensureSupabaseJwt:async subject=>{mintSubjects.push(subject);if(options.switchDuringMint)switchAccount();if(options.mintThrows)throw Error('bridge unavailable');return !options.bridgeFails;}},
  './auth-helper':{getCurrentUserIdSync:()=>userId},'../supabase/db-map':{DB:{}},
 };
 function load(file){const exports={};const source=ts.transpileModule(fs.readFileSync(path.join(__dirname,file),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;vm.runInNewContext(source,{exports,require:name=>deps[name]??{},console:{log(){},error(){},warn(){}},Date});return exports;}
 deps['./notification-access']=load('notification-access.ts');
 return {api:load('notifications.ts').notificationsApi,calls,mintSubjects,rows,switchAccount};
}
const methods=[['getNotifications',[]],['getBadges',[]],['markAsRead',['10']],['markAllAsRead',[]]];
for(const [method,args]of methods)for(const scenario of ['signedOut','bridgeFails','mintThrows','switchDuringProfile','switchDuringMint'])test(`${method}: ${scenario} never issues a notification request`,async()=>{const f=fixture({[scenario]:true});await assert.rejects(f.api[method](...args));assert.equal(f.calls.length,0);});
test('read and badge use canonical current recipient and verified auth ID with request epoch',async()=>{const f=fixture();const page=await f.api.getNotifications();assert.equal(page.docs.length,1);assert.equal(page.docs[0].id,'10');assert.equal((await f.api.getBadges()).unread,1);assert.deepEqual(f.mintSubjects,['auth-A','auth-A']);for(const c of f.calls){assert.ok(c.filters.some(([k,v])=>k==='recipient_id'&&v===1));assert.equal(c.headers['x-dvnt-bridge-epoch'],'0');}});
test('mark-one confirms owned row, updates only read_at and never another recipient',async()=>{const f=fixture();assert.equal((await f.api.markAsRead('10')).success,true);assert.ok(f.rows[0].read_at);assert.equal(f.rows[1].read_at,null);assert.deepEqual(Object.keys(f.calls[0].patch),['read_at']);await assert.rejects(f.api.markAsRead('20'),/unavailable/);assert.equal(f.rows[1].read_at,null);});
test('mark-all scopes recipient, succeeds for already-read inbox, never touches another account',async()=>{const f=fixture();assert.equal((await f.api.markAllAsRead()).success,true);assert.equal((await f.api.markAllAsRead()).success,true);assert.ok(f.rows[0].read_at);assert.equal(f.rows[1].read_at,null);assert.equal((await f.api.getBadges()).unread,0);});
for(const method of ['getNotifications','getBadges'])test(`${method} rejects an account switch after the response instead of returning stale data`,async()=>{const f=fixture({switchAfterResult:true});await assert.rejects(f.api[method](),/account changed/);});
for(const options of [{queryError:true},{missingCount:true}])test(`badge uncertainty is not a fake zero ${JSON.stringify(options)}`,async()=>{await assert.rejects(fixture(options).api.getBadges());});
for(const profile of [null,{id:2,authId:'auth-B'},{id:1,authId:''}])test(`canonical profile mismatch never queries notifications ${JSON.stringify(profile)}`,async()=>{const f=fixture({profile});await assert.rejects(f.api.getNotifications(),/verify/);assert.equal(f.calls.length,0);assert.equal(f.mintSubjects.length,0);});
for(const id of ['10junk','-1','0','1.5','9007199254740993'])test(`invalid mark-read ID ${id} never queries`,async()=>{const f=fixture();await assert.rejects(f.api.markAsRead(id),/Invalid/);assert.equal(f.calls.length,0);});
test('a subsequent account uses its own subject and recipient, never a cached prior identity',async()=>{const f=fixture();await f.api.getBadges();f.switchAccount();assert.equal((await f.api.getBadges()).unread,1);assert.deepEqual(f.mintSubjects,['auth-A','auth-B']);assert.ok(f.calls[1].filters.some(([k,v])=>k==='recipient_id'&&v===2));assert.equal(f.calls[1].headers['x-dvnt-bridge-epoch'],'1');});
for(const [method,args]of methods)test(`${method}: query errors are surfaced instead of false success`,async()=>{const f=fixture({queryError:true});await assert.rejects(f.api[method](...args));});
for(const method of ['markAsRead','markAllAsRead'])test(`${method}: stale post-response account never gets successful UI acknowledgement`,async()=>{const f=fixture({switchAfterResult:true});await assert.rejects(f.api[method](...(method==='markAsRead'?['10']:[])),/account changed/);});
